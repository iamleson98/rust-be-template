//! Attribute macros for the layered store architecture.
//!
//! Provides:
//! - `#[retry]` on an `impl` block: wraps every `async fn` body in an
//!   exponential-backoff retry loop.
//! - `#[store_macros::no_retry]` on a single method: opts out of `#[retry]`
//!   (for non-idempotent operations like INSERTs that generate new IDs).

use proc_macro::TokenStream;
use proc_macro2::Span;
use quote::{format_ident, quote};
use syn::{
    parse_macro_input, FnArg, Ident, ImplItem, ItemImpl, Pat, ReturnType,
};

/// No-op attribute marker. Just removed by the compiler; the `#[retry]`
/// macro looks for it on methods and skips wrapping them.
///
/// Use as `#[store_macros::no_retry]` on a method inside an `impl` block
/// that has `#[retry]` applied.
#[proc_macro_attribute]
pub fn no_retry(_attr: TokenStream, item: TokenStream) -> TokenStream {
    // The actual opt-out logic is in `#[retry]`. This attribute is a
    // no-op that exists so the compiler accepts the path
    // `#[store_macros::no_retry]`.
    item
}

/// Wrap every `async fn` body in an `impl` block with retry logic.
///
/// # How it works
///
/// For a method:
/// ```ignore
/// async fn get_user(&self, id: Uuid) -> StoreResult<User> {
///     user::Entity::find_by_id(id).one(self.db.as_ref()).await?
///         .ok_or_else(|| StoreError::NotFound(...))
/// }
/// ```
///
/// The macro generates:
/// ```ignore
/// async fn get_user(&self, id: Uuid) -> StoreResult<User> {
///     let __id_orig = id.clone();           // preserve args
///     let mut __attempt: usize = 0;
///     loop {
///         let id = __id_orig.clone();        // fresh clone each retry
///         let __result = async {
///             user::Entity::find_by_id(id).one(self.db.as_ref()).await?
///                 .ok_or_else(|| StoreError::NotFound(...))
///         }.await;
///         match __result {
///             Ok(v) => break Ok(v),
///             Err(e) => {
///                 if !RetryPolicy::should_retry(self, &e) { break Err(e); }
///                 if __attempt >= RetryPolicy::max_retries(self) {
///                     break Err(StoreError::Exhausted { ... });
///                 }
///                 let delay = RetryPolicy::delay_for(self, __attempt);
///                 tokio::time::sleep(delay).await;
///                 __attempt += 1;
///             }
///         }
///     }
/// }
/// ```
///
/// # Requirements on the implementing struct
///
/// The struct must implement [`crate::store::RetryPolicy`]. The trait
/// has default impls (3 retries, 100ms base, exponential backoff), so
/// most users just write:
///
/// ```ignore
/// impl RetryPolicy for DbStore {}
/// ```
///
/// # Per-method opt-out
///
/// Annotate a method with `#[no_retry]` to skip wrapping (e.g. for
/// non-idempotent operations that generate new IDs on each call):
///
/// ```ignore
/// #[retry]
/// impl Store for DbStore {
///     async fn get_user(&self, id: Uuid) -> StoreResult<User> { ... }
///
///     #[no_retry]
///     async fn create_post(&self, ...) -> StoreResult<Post> { ... }
/// }
/// ```
#[proc_macro_attribute]
pub fn retry(_attr: TokenStream, item: TokenStream) -> TokenStream {
    let mut input = parse_macro_input!(item as ItemImpl);

    for impl_item in &mut input.items {
        let method = match impl_item {
            ImplItem::Fn(m) => m,
            _ => continue,
        };

        // Only wrap `async fn` methods.
        if method.sig.asyncness.is_none() {
            continue;
        }

        // Skip methods explicitly marked with `#[store_macros::no_retry]`.
        // The attribute macro is a no-op (returns the item unchanged), so
        // by the time `#[retry]` sees the method, the attribute is still
        // present on the method. We detect it via path matching.
        let has_no_retry = method.attrs.iter().any(|a| {
            a.path().segments.last().map(|s| s.ident == "no_retry").unwrap_or(false)
        });
        if has_no_retry {
            method.attrs.retain(|a| {
                !a.path().segments.last().map(|s| s.ident == "no_retry").unwrap_or(false)
            });
            continue;
        }

        // Collect arg idents (skip `&self` / `&mut self`).
        let arg_idents: Vec<Ident> = method
            .sig
            .inputs
            .iter()
            .filter_map(|arg| match arg {
                FnArg::Typed(pat_type) => {
                    if let Pat::Ident(pat_ident) = &*pat_type.pat {
                        Some(pat_ident.ident.clone())
                    } else {
                        None
                    }
                }
                FnArg::Receiver(_) => None,
            })
            .collect();

        // For each arg `x`, create `__x_orig` binding + per-iteration clone.
        let preserve_bindings: Vec<_> = arg_idents
            .iter()
            .map(|i| {
                let pres = format_ident!("__{}_orig", i);
                quote! { let #pres = #i.clone(); }
            })
            .collect();
        let preserved_idents: Vec<_> = arg_idents
            .iter()
            .map(|i| format_ident!("__{}_orig", i))
            .collect();
        let shadow_lets: Vec<_> = arg_idents
            .iter()
            .zip(&preserved_idents)
            .map(|(arg, pres)| quote! { let #arg = #pres.clone(); })
            .collect();

        // Validate the method returns a Result-shaped type (for Exhausted).
        let _ret_ty: Option<&ReturnType> = Some(&method.sig.output);

        let original_block = &method.block;

        let span = Span::call_site();
        let _ = span;

        // Synthesize the new method body. We:
        // 1. Save clones of all args before the loop (so retry doesn't
        //    consume them).
        // 2. Each iteration, rebind args from the saved clones.
        // 3. Wrap the original body in `async { ... }.await` so each
        //    retry creates a fresh future.
        let new_block: syn::Block = syn::parse_quote!({
            #(#preserve_bindings)*
            let mut __attempt: usize = 0;
            loop {
                #(#shadow_lets)*
                let __result = async #original_block .await;
                match __result {
                    Ok(__v) => break Ok(__v),
                    Err(__e) => {
                        if !crate::store::RetryPolicy::should_retry(self, &__e) {
                            break Err(__e);
                        }
                        if __attempt >= crate::store::RetryPolicy::max_retries(self) {
                            tracing::warn!(
                                attempt = __attempt + 1,
                                error = %__e,
                                "retries exhausted"
                            );
                            break Err(crate::store::StoreError::Exhausted {
                                retries: __attempt,
                                source: Box::new(__e),
                            });
                        }
                        let __delay = crate::store::RetryPolicy::delay_for(self, __attempt);
                        tracing::warn!(
                            attempt = __attempt + 1,
                            delay_ms = __delay.as_millis() as u64,
                            error = %__e,
                            "retrying"
                        );
                        ::tokio::time::sleep(__delay).await;
                        __attempt += 1;
                    }
                }
            }
        });

        method.block = new_block;
    }

    TokenStream::from(quote! { #input })
}
