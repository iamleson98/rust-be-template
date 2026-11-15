use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use chrono::{DateTime, SecondsFormat, Utc};
use sea_orm::sea_query::Expr;
use sea_orm::{
    ActiveModelTrait, ColumnTrait, Condition, ConnectionTrait, DatabaseBackend, DatabaseConnection,
    EntityTrait, PaginatorTrait, QueryFilter, QueryOrder, QuerySelect, Set, Statement, Value,
};
use store_macros::retry;
use uuid::Uuid;

use crate::auth::account::{NewAccount, NewBot, PasswordRehash};
use crate::auth::oauth::OAuthProfile;
use crate::cache::{get_serializable, set_serializable, CacheBackend};
use crate::db::write::with_write;
use crate::entity::{refresh_tokens, user};

use super::error::{StoreError, StoreResult};
use super::retry::RetryPolicy;

#[async_trait]
pub trait UserStore: Send + Sync {
    async fn get_user(&self, id: Uuid) -> StoreResult<user::Model>;
    async fn get_user_by_email(&self, email: String) -> StoreResult<Option<user::Model>>;
    async fn create_user(
        &self,
        email: String,
        username: String,
        password_hash: String,
        role: String,
    ) -> StoreResult<user::Model>;
    /// Create the NullClaw bot support account: the `employee` role
    /// with `is_bot = true`. The bot staffs the support queue (it is a
    /// channel member and posts AI replies), but every human-only code
    /// path — first-admin bootstrap, last-admin demotion guard,
    /// presence / chat-assignment routing — filters on
    /// `is_bot = false`, so the bot can never masquerade as a human
    /// staff member.
    async fn create_bot_user(
        &self,
        email: String,
        username: String,
        password_hash: String,
    ) -> StoreResult<user::Model>;
    /// Normalize an existing NullClaw bot account to the canonical
    /// state (`role = "employee"`, `is_bot = true`). Returns the
    /// updated model when a row was changed, `None` when the bot
    /// doesn't exist yet or is already canonical. Self-heals databases
    /// created before the three-role refactor without a data
    /// migration.
    async fn normalize_bot_account(&self, email: &str) -> StoreResult<Option<user::Model>>;
    /// Look up a user by their OAuth `(provider, subject)` pair.
    /// Returns `None` if no user is linked to this OAuth identity yet.
    async fn get_user_by_oauth(
        &self,
        provider: &str,
        subject: &str,
    ) -> StoreResult<Option<user::Model>>;
    /// Sign in with an OAuth identity, in one write transaction.
    ///
    /// 1. A user already linked to `(provider, subject)` is returned.
    /// 2. Otherwise a user with the same email (exact, else the only
    ///    case-insensitive match) is linked to the identity and its email
    ///    marked verified. A password account whose email was never
    ///    verified may belong to someone who registered an address that is
    ///    not theirs; the provider has now verified it for the person at
    ///    the door, so that password is cleared and every refresh token of
    ///    the account revoked.
    /// 3. Otherwise a verified, password-less account is created (the
    ///    first human becomes `admin`, as at registration).
    async fn upsert_oauth_user(
        &self,
        profile: OAuthProfile,
        bot: NewBot,
    ) -> StoreResult<user::Model>;
    async fn delete_user(&self, id: Uuid) -> StoreResult<()>;
    async fn count_users(&self) -> StoreResult<u64>;
    /// Paginated list of users, newest first. Used by `UserService::list`.
    async fn list_users(&self, limit: u64, offset: u64) -> StoreResult<Vec<user::Model>>;
    /// Find the first non-bot staff member (role "admin" or
    /// "employee") — the bootstrap account that owns the support queue
    /// by default. Ordered by `created_at ASC` so we get the FIRST
    /// registered staff user. On migrated databases the first account
    /// was promoted to `admin` (see the three-roles migration).
    async fn find_first_staff_member(&self) -> StoreResult<Option<user::Model>>;
    /// Count non-bot users holding a given role ("admin" / "employee").
    /// Guards the last-admin demotion.
    async fn count_by_role(&self, role: &str) -> StoreResult<i64>;
    /// Update a user's role column. RBAC grants are managed separately.
    async fn set_user_role(&self, user_id: Uuid, role: &str) -> StoreResult<user::Model>;

    /// Register a password account in one write transaction. The role is
    /// decided inside the INSERT: the first human account (the bot never
    /// counts) becomes `admin`, everyone else a `user`, so two simultaneous
    /// first signups cannot both become admin. The first admin also brings
    /// the support `bot`. Role grants are written with the account.
    ///
    /// A taken email or phone is a `Conflict` naming it.
    async fn register_account(&self, account: NewAccount, bot: NewBot) -> StoreResult<user::Model>;

    /// The account whose email is `email`: the exact match, else the only
    /// case-insensitive one (two accounts differing in case only never
    /// resolve for a differently-cased spelling).
    async fn find_account_by_email(&self, email: &str) -> StoreResult<Option<user::Model>>;

    /// The one account whose phone or phone-as-email is any of
    /// `spellings`. A number two accounts claim identifies nobody.
    async fn find_account_by_phone(&self, spellings: &[String])
        -> StoreResult<Option<user::Model>>;

    /// Count a wrong password against the account in a single UPDATE, so
    /// concurrent guesses cannot slip past the limit. An expired lock
    /// restarts the count; the `max_failures`-th failure locks the account
    /// for `lock_secs`.
    async fn record_failed_login(
        &self,
        user_id: Uuid,
        max_failures: u32,
        lock_secs: u64,
    ) -> StoreResult<()>;

    /// Record a successful sign-in: clear the failure count and the lock,
    /// stamp the time and client address, and replace the stored hash when
    /// `rehash` is given and that hash is still the stored one.
    async fn record_login_success(
        &self,
        user_id: Uuid,
        ip: Option<String>,
        rehash: Option<PasswordRehash>,
    ) -> StoreResult<()>;

    /// Replace the user's password hash, clear the failure count and the
    /// lock, and revoke every refresh token of the user, atomically.
    async fn change_password(&self, user_id: Uuid, hash: &str) -> StoreResult<()>;
}

#[derive(Clone)]
pub struct DbUserStore {
    db: Arc<DatabaseConnection>,
}

impl DbUserStore {
    pub fn new(db: Arc<DatabaseConnection>) -> Self {
        Self { db }
    }

    /// Shared INSERT behind [`UserStore::create_user`] (humans) and
    /// [`UserStore::create_bot_user`] (the NullClaw bot) — identical
    /// column set, differing only in the `is_bot` flag.
    async fn insert_user(
        &self,
        email: String,
        full_name: String,
        password_hash: String,
        role: String,
        is_bot: bool,
    ) -> StoreResult<user::Model> {
        let now = Utc::now();
        let id = Uuid::new_v4();
        let model = user::ActiveModel {
            id: Set(id),
            email: Set(email.clone()),
            full_name: Set(full_name.clone()),
            password_hash: Set(Some(password_hash.clone())),
            created_at: Set(now),
            updated_at: Set(now),
            brand_id: Set(None),
            phone: Set(None),
            email_verified_at: Set(None),
            phone_verified_at: Set(None),
            status: Set("active".into()),
            block_reason: Set(None),
            avatar_url: Set(None),
            locale: Set("vi".into()),
            is_guest: Set(false),
            is_bot: Set(is_bot),
            role: Set(role.clone()),
            failed_login_attempts: Set(0),
            locked_until: Set(None),
            last_login_at: Set(None),
            last_login_ip: Set(None),
            password_changed_at: Set(None),
            oauth_provider: Set(None),
            oauth_subject: Set(None),
        };

        match user::Entity::insert(model)
            .exec_without_returning(self.db.as_ref())
            .await
        {
            Ok(_) => Ok(user::Model {
                id,
                email,
                password_hash: Some(password_hash),
                created_at: now,
                updated_at: now,
                brand_id: None,
                full_name,
                phone: None,
                email_verified_at: None,
                phone_verified_at: None,
                status: "active".into(),
                block_reason: None,
                avatar_url: None,
                locale: "vi".into(),
                is_guest: false,
                is_bot,
                role,
                failed_login_attempts: 0,
                locked_until: None,
                last_login_at: None,
                last_login_ip: None,
                password_changed_at: None,
                oauth_provider: None,
                oauth_subject: None,
            }),
            // A UNIQUE / PRIMARY KEY collision maps to `Conflict` by SQLite
            // result code (see `StoreError::from(DbErr)`), not by message.
            Err(e) => Err(e.into()),
        }
    }
}

impl RetryPolicy for DbUserStore {}

#[async_trait]
#[retry]
impl UserStore for DbUserStore {
    async fn get_user(&self, id: Uuid) -> StoreResult<user::Model> {
        user::Entity::find_by_id(id)
            .one(self.db.as_ref())
            .await?
            .ok_or_else(|| StoreError::NotFound(format!("user {id}")))
    }

    async fn get_user_by_email(&self, email: String) -> StoreResult<Option<user::Model>> {
        Ok(user::Entity::find()
            .filter(user::Column::Email.eq(email))
            .one(self.db.as_ref())
            .await?)
    }

    #[store_macros::no_retry]
    async fn create_user(
        &self,
        email: String,
        full_name: String,
        password_hash: String,
        role: String,
    ) -> StoreResult<user::Model> {
        Self::insert_user(self, email, full_name, password_hash, role, false).await
    }

    async fn create_bot_user(
        &self,
        email: String,
        username: String,
        password_hash: String,
    ) -> StoreResult<user::Model> {
        Self::insert_user(
            self,
            email,
            username,
            password_hash,
            "employee".into(),
            true,
        )
        .await
    }

    async fn normalize_bot_account(&self, email: &str) -> StoreResult<Option<user::Model>> {
        let Some(existing) = self.get_user_by_email(email.to_string()).await? else {
            return Ok(None);
        };
        if existing.is_bot && existing.role == "employee" {
            return Ok(None);
        }
        let mut active: user::ActiveModel = existing.into();
        active.role = Set("employee".into());
        active.is_bot = Set(true);
        active.updated_at = Set(Utc::now());
        Ok(Some(active.update(self.db.as_ref()).await?))
    }

    async fn get_user_by_oauth(
        &self,
        provider: &str,
        subject: &str,
    ) -> StoreResult<Option<user::Model>> {
        Ok(user::Entity::find()
            .filter(user::Column::OauthProvider.eq(provider))
            .filter(user::Column::OauthSubject.eq(subject))
            .one(self.db.as_ref())
            .await?)
    }

    #[store_macros::no_retry]
    async fn upsert_oauth_user(
        &self,
        profile: OAuthProfile,
        bot: NewBot,
    ) -> StoreResult<user::Model> {
        with_write(self.db.as_ref(), |tx| {
            let (profile, bot) = (profile.clone(), bot.clone());
            Box::pin(async move { upsert_oauth_in(tx, &profile, &bot).await })
        })
        .await
    }

    async fn delete_user(&self, id: Uuid) -> StoreResult<()> {
        user::Entity::delete_by_id(id)
            .exec(self.db.as_ref())
            .await?;
        Ok(())
    }

    async fn count_users(&self) -> StoreResult<u64> {
        Ok(user::Entity::find().count(self.db.as_ref()).await?)
    }

    async fn list_users(&self, limit: u64, offset: u64) -> StoreResult<Vec<user::Model>> {
        Ok(user::Entity::find()
            .order_by_desc(user::Column::CreatedAt)
            .limit(limit)
            .offset(offset)
            .all(self.db.as_ref())
            .await?)
    }

    async fn find_first_staff_member(&self) -> StoreResult<Option<user::Model>> {
        Ok(user::Entity::find()
            .filter(user::Column::Role.is_in(["admin", "employee"]))
            .filter(user::Column::IsBot.eq(false))
            .order_by_asc(user::Column::CreatedAt)
            .limit(1)
            .one(self.db.as_ref())
            .await?)
    }

    async fn count_by_role(&self, role: &str) -> StoreResult<i64> {
        Ok(user::Entity::find()
            .filter(user::Column::Role.eq(role))
            .filter(user::Column::IsBot.eq(false))
            .count(self.db.as_ref())
            .await? as i64)
    }

    async fn set_user_role(&self, user_id: Uuid, role: &str) -> StoreResult<user::Model> {
        let existing = user::Entity::find_by_id(user_id)
            .one(self.db.as_ref())
            .await?
            .ok_or_else(|| StoreError::NotFound(format!("user {user_id}")))?;
        let mut active: user::ActiveModel = existing.into();
        active.role = Set(role.to_string());
        active.updated_at = Set(Utc::now());
        Ok(active.update(self.db.as_ref()).await?)
    }

    #[store_macros::no_retry]
    async fn register_account(&self, account: NewAccount, bot: NewBot) -> StoreResult<user::Model> {
        with_write(self.db.as_ref(), |tx| {
            let (account, bot) = (account.clone(), bot.clone());
            Box::pin(async move { register_in(tx, &account, &bot).await })
        })
        .await
    }

    async fn find_account_by_email(&self, email: &str) -> StoreResult<Option<user::Model>> {
        find_by_email(self.db.as_ref(), email).await
    }

    async fn find_account_by_phone(
        &self,
        spellings: &[String],
    ) -> StoreResult<Option<user::Model>> {
        let mut found = user::Entity::find()
            .filter(
                Condition::any()
                    .add(user::Column::Phone.is_in(spellings.to_vec()))
                    .add(user::Column::Email.is_in(spellings.to_vec())),
            )
            .limit(2)
            .all(self.db.as_ref())
            .await?;
        Ok(if found.len() == 1 { found.pop() } else { None })
    }

    async fn record_failed_login(
        &self,
        user_id: Uuid,
        max_failures: u32,
        lock_secs: u64,
    ) -> StoreResult<()> {
        let now = Utc::now();
        let until =
            now + chrono::Duration::seconds(i64::try_from(lock_secs).unwrap_or(i64::MAX / 2));
        // Attempts counted so far, ignoring a lock that has already run
        // out. Every right-hand side reads the row as it was before the
        // UPDATE, so the count, the lock decision and the restart are one
        // atomic step.
        const BASE: &str = "(CASE WHEN locked_until IS NOT NULL AND locked_until <= ? THEN 0 \
                            ELSE failed_login_attempts END)";
        let sql = format!(
            "UPDATE \"user\" SET failed_login_attempts = {BASE} + 1, \
             locked_until = CASE WHEN {BASE} + 1 >= ? THEN ? ELSE NULL END \
             WHERE id = ?"
        );
        let now_iso = iso(now);
        execute(
            self.db.as_ref(),
            &sql,
            [
                now_iso.clone().into(),
                now_iso.into(),
                i64::from(max_failures).into(),
                iso(until).into(),
                user_id.into(),
            ],
        )
        .await?;
        Ok(())
    }

    async fn record_login_success(
        &self,
        user_id: Uuid,
        ip: Option<String>,
        rehash: Option<PasswordRehash>,
    ) -> StoreResult<()> {
        let (old, new) = match rehash {
            Some(r) => (Some(r.old), Some(r.new)),
            None => (None, None),
        };
        execute(
            self.db.as_ref(),
            "UPDATE \"user\" SET failed_login_attempts = 0, locked_until = NULL, \
             last_login_at = ?, last_login_ip = ?, \
             password_hash = CASE WHEN password_hash = ? THEN ? ELSE password_hash END \
             WHERE id = ?",
            [
                iso(Utc::now()).into(),
                ip.into(),
                old.into(),
                new.into(),
                user_id.into(),
            ],
        )
        .await?;
        Ok(())
    }

    #[store_macros::no_retry]
    async fn change_password(&self, user_id: Uuid, hash: &str) -> StoreResult<()> {
        with_write(self.db.as_ref(), |tx| {
            let hash = hash.to_string();
            Box::pin(async move {
                let now = Utc::now();
                let changed = execute(
                    tx,
                    "UPDATE \"user\" SET password_hash = ?, failed_login_attempts = 0, \
                     locked_until = NULL, password_changed_at = ?, updated_at = ? WHERE id = ?",
                    [hash.into(), iso(now).into(), now.into(), user_id.into()],
                )
                .await?;
                if changed == 0 {
                    return Err(StoreError::NotFound(format!("user {user_id}")));
                }
                revoke_refresh_tokens(tx, user_id).await
            })
        })
        .await
    }
}

// ── Write-transaction helpers ────────────────────────────────────────

/// A fixed-width ISO-8601 UTC string: the shape of the text timestamp
/// columns (`locked_until`, `email_verified_at`, …), which compare
/// lexicographically.
fn iso(at: DateTime<Utc>) -> String {
    at.to_rfc3339_opts(SecondsFormat::Secs, true)
}

/// Run one parameterised statement; returns the rows it changed.
async fn execute<C, const N: usize>(db: &C, sql: &str, values: [Value; N]) -> StoreResult<u64>
where
    C: ConnectionTrait,
{
    let stmt = Statement::from_sql_and_values(DatabaseBackend::Sqlite, sql, values);
    Ok(db.execute(stmt).await?.rows_affected())
}

/// Revoke every live refresh token of `user_id`.
async fn revoke_refresh_tokens<C: ConnectionTrait>(db: &C, user_id: Uuid) -> StoreResult<()> {
    refresh_tokens::Entity::update_many()
        .col_expr(refresh_tokens::Column::Revoked, Expr::value(true))
        .filter(refresh_tokens::Column::UserId.eq(user_id))
        .filter(refresh_tokens::Column::Revoked.eq(false))
        .exec(db)
        .await?;
    Ok(())
}

async fn find_by_email<C: ConnectionTrait>(
    db: &C,
    email: &str,
) -> StoreResult<Option<user::Model>> {
    if let Some(exact) = user::Entity::find()
        .filter(user::Column::Email.eq(email))
        .one(db)
        .await?
    {
        return Ok(Some(exact));
    }
    let mut loose = user::Entity::find()
        .filter(Expr::cust_with_values(
            "lower(email) = ?",
            [email.to_lowercase()],
        ))
        .limit(2)
        .all(db)
        .await?;
    Ok(if loose.len() == 1 { loose.pop() } else { None })
}

async fn exists<C: ConnectionTrait>(db: &C, sql: &str, values: [Value; 1]) -> StoreResult<bool> {
    let stmt = Statement::from_sql_and_values(DatabaseBackend::Sqlite, sql, values);
    Ok(db.query_one(stmt).await?.is_some())
}

/// The columns of an account that is about to be inserted.
struct NewUserRow {
    full_name: String,
    email: String,
    phone: Option<String>,
    email_verified_at: Option<String>,
    password_hash: Option<String>,
    avatar_url: Option<String>,
    locale: String,
    oauth: Option<(String, String)>,
}

/// Insert an account whose role is decided by the statement itself (the
/// first human is `admin`), grant it that role, and for the first admin
/// seed the support bot. Returns the stored row.
async fn provision<C: ConnectionTrait>(
    tx: &C,
    row: NewUserRow,
    bot: &NewBot,
) -> StoreResult<user::Model> {
    let id = Uuid::new_v4();
    let now = Utc::now();
    let (oauth_provider, oauth_subject) = match row.oauth {
        Some((provider, subject)) => (Some(provider), Some(subject)),
        None => (None, None),
    };
    execute(
        tx,
        "INSERT INTO \"user\" (id, full_name, email, phone, email_verified_at, password_hash, \
         avatar_url, locale, role, oauth_provider, oauth_subject, created_at, updated_at) \
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, \
         CASE WHEN EXISTS (SELECT 1 FROM \"user\" WHERE is_bot = 0) THEN 'user' ELSE 'admin' END, \
         ?, ?, ?, ?",
        [
            id.into(),
            row.full_name.into(),
            row.email.into(),
            row.phone.into(),
            row.email_verified_at.into(),
            row.password_hash.into(),
            row.avatar_url.into(),
            row.locale.into(),
            oauth_provider.into(),
            oauth_subject.into(),
            now.into(),
            now.into(),
        ],
    )
    .await?;
    let created = user::Entity::find_by_id(id)
        .one(tx)
        .await?
        .ok_or_else(|| StoreError::NotFound(format!("user {id}")))?;
    if created.role == "admin" {
        seed_bot(tx, bot, now).await?;
    }
    grant_role(tx, created.id, &created.role, now).await?;
    Ok(created)
}

/// Create the support bot unless it exists, and give it the `employee`
/// role. The bot is an employee flagged `is_bot` and can never sign in.
async fn seed_bot<C: ConnectionTrait>(tx: &C, bot: &NewBot, now: DateTime<Utc>) -> StoreResult<()> {
    execute(
        tx,
        "INSERT INTO \"user\" (id, full_name, email, password_hash, locale, role, is_bot, \
         created_at, updated_at) \
         SELECT ?, ?, ?, ?, 'vi', 'employee', 1, ?, ? \
         WHERE NOT EXISTS (SELECT 1 FROM \"user\" WHERE email = ?)",
        [
            Uuid::new_v4().into(),
            bot.full_name.clone().into(),
            bot.email.clone().into(),
            bot.password_hash.clone().into(),
            now.into(),
            now.into(),
            bot.email.clone().into(),
        ],
    )
    .await?;
    execute(
        tx,
        "INSERT INTO user_roles (user_id, role_id, assigned_at) \
         SELECT u.id, r.id, ? FROM \"user\" u, roles r \
         WHERE u.email = ? AND r.name = 'employee' \
         ON CONFLICT DO NOTHING",
        [now.into(), bot.email.clone().into()],
    )
    .await?;
    Ok(())
}

/// Grant `user_id` the role named `role` (a no-op when held or unknown).
async fn grant_role<C: ConnectionTrait>(
    tx: &C,
    user_id: Uuid,
    role: &str,
    now: DateTime<Utc>,
) -> StoreResult<()> {
    execute(
        tx,
        "INSERT INTO user_roles (user_id, role_id, assigned_at) \
         SELECT ?, id, ? FROM roles WHERE name = ? \
         ON CONFLICT DO NOTHING",
        [user_id.into(), now.into(), role.to_string().into()],
    )
    .await?;
    Ok(())
}

async fn register_in<C: ConnectionTrait>(
    tx: &C,
    account: &NewAccount,
    bot: &NewBot,
) -> StoreResult<user::Model> {
    if let Some(email) = &account.email {
        if exists(
            tx,
            "SELECT 1 FROM \"user\" WHERE lower(email) = lower(?) LIMIT 1",
            [email.clone().into()],
        )
        .await?
        {
            return Err(StoreError::Conflict("email already registered".into()));
        }
    }
    if let Some(phone) = &account.phone {
        if exists(
            tx,
            "SELECT 1 FROM \"user\" WHERE phone = ?1 OR email = ?1 LIMIT 1",
            [phone.clone().into()],
        )
        .await?
        {
            return Err(StoreError::Conflict("phone already registered".into()));
        }
    }
    // A phone-only signup keeps the number in the email column too, so
    // the unique email key still identifies the account.
    let identity = account.email.clone().or_else(|| account.phone.clone());
    let Some(email) = identity else {
        return Err(StoreError::Validation("email or phone is required".into()));
    };
    provision(
        tx,
        NewUserRow {
            full_name: account.full_name.clone(),
            email,
            phone: account.phone.clone(),
            email_verified_at: None,
            password_hash: Some(account.password_hash.clone()),
            avatar_url: None,
            locale: account.locale.clone(),
            oauth: None,
        },
        bot,
    )
    .await
    .map_err(unique_violation_means_taken)
}

/// A UNIQUE collision that slipped past the existence checks (a
/// concurrent signup of the same address) is still "taken".
fn unique_violation_means_taken(e: StoreError) -> StoreError {
    if e.is_record_exists() {
        StoreError::Conflict("account already registered".into())
    } else {
        e
    }
}

async fn upsert_oauth_in<C: ConnectionTrait>(
    tx: &C,
    profile: &OAuthProfile,
    bot: &NewBot,
) -> StoreResult<user::Model> {
    if let Some(linked) = user::Entity::find()
        .filter(user::Column::OauthProvider.eq(profile.provider.as_str()))
        .filter(user::Column::OauthSubject.eq(profile.subject.as_str()))
        .one(tx)
        .await?
    {
        return Ok(linked);
    }

    let now = Utc::now();
    let Some(existing) = find_by_email(tx, &profile.email).await? else {
        return provision(
            tx,
            NewUserRow {
                full_name: profile.name.clone(),
                email: profile.email.clone(),
                phone: None,
                email_verified_at: Some(iso(now)),
                password_hash: None,
                avatar_url: profile.avatar_url.clone(),
                locale: "vi".into(),
                oauth: Some((profile.provider.clone(), profile.subject.clone())),
            },
            bot,
        )
        .await
        .map_err(|e| {
            if e.is_record_exists() {
                StoreError::Conflict("account exists".into())
            } else {
                e
            }
        });
    };

    // Nobody ever proved they own this address: whoever registered it with
    // a password may be a stranger who got there first.
    let squatted = existing.password_hash.is_some() && existing.email_verified_at.is_none();
    let user_id = existing.id;
    let verified_at = existing
        .email_verified_at
        .clone()
        .unwrap_or_else(|| iso(now));
    let mut link: user::ActiveModel = existing.into();
    link.oauth_provider = Set(Some(profile.provider.clone()));
    link.oauth_subject = Set(Some(profile.subject.clone()));
    if let Some(avatar) = &profile.avatar_url {
        link.avatar_url = Set(Some(avatar.clone()));
    }
    link.email_verified_at = Set(Some(verified_at));
    if squatted {
        link.password_hash = Set(None);
        link.password_changed_at = Set(Some(iso(now)));
    }
    link.updated_at = Set(now);
    let linked = link.update(tx).await?;
    if squatted {
        revoke_refresh_tokens(tx, user_id).await?;
    }
    Ok(linked)
}
pub struct CacheUserStore<S: UserStore> {
    pub inner: Arc<S>,
    pub cache: Arc<dyn CacheBackend>,
    pub ttl: Duration,
}

impl<S: UserStore> CacheUserStore<S> {
    pub fn new(inner: S, cache: Arc<dyn CacheBackend>, ttl: Duration) -> Self {
        Self {
            inner: Arc::new(inner),
            cache,
            ttl,
        }
    }
}

impl<S: UserStore> Clone for CacheUserStore<S> {
    fn clone(&self) -> Self {
        Self {
            inner: self.inner.clone(),
            cache: self.cache.clone(),
            ttl: self.ttl,
        }
    }
}

impl<S: UserStore> CacheUserStore<S> {
    /// Drop the cached entity and permission bundle of a user whose row
    /// changed, so the next read loads the fresh state.
    async fn forget(&self, id: Uuid) {
        let _ = self.cache.delete(&user_key(id)).await;
        let _ = self.cache.delete(&perms_key(id)).await;
    }
}

fn user_key(id: Uuid) -> String {
    format!("entity:user:{id}")
}

// `rbac:perms:{id}` — shared with `CacheRbacStore` (see `store::keys`).
use super::keys::perms_key;

#[async_trait]
impl<S: UserStore> UserStore for CacheUserStore<S> {
    async fn get_user(&self, id: Uuid) -> StoreResult<user::Model> {
        let key = user_key(id);
        match get_serializable::<user::Model>(self.cache.as_ref(), &key).await {
            Ok(Some(v)) => return Ok(v),
            Ok(None) => {}
            Err(e) => {
                tracing::debug!(key = %key, error = %e, "cache read failed; falling through to DB");
            }
        }

        let model = self.inner.get_user(id).await?;
        if let Err(e) = set_serializable(self.cache.as_ref(), &key, &model, Some(self.ttl)).await {
            tracing::debug!(key = %key, error = %e, "cache write failed; will re-fetch on next miss");
        }
        Ok(model)
    }

    async fn get_user_by_email(&self, email: String) -> StoreResult<Option<user::Model>> {
        self.inner.get_user_by_email(email).await
    }

    async fn create_user(
        &self,
        email: String,
        username: String,
        password_hash: String,
        role: String,
    ) -> StoreResult<user::Model> {
        self.inner
            .create_user(email, username, password_hash, role)
            .await
    }

    async fn create_bot_user(
        &self,
        email: String,
        username: String,
        password_hash: String,
    ) -> StoreResult<user::Model> {
        self.inner
            .create_bot_user(email, username, password_hash)
            .await
    }

    async fn normalize_bot_account(&self, email: &str) -> StoreResult<Option<user::Model>> {
        let updated = self.inner.normalize_bot_account(email).await?;
        // The bot's `role` / `is_bot` columns changed — drop the cached
        // entity so SessionUser::from_model sees the fresh state.
        if let Some(m) = &updated {
            let _ = self.cache.delete(&user_key(m.id)).await;
        }
        Ok(updated)
    }

    async fn get_user_by_oauth(
        &self,
        provider: &str,
        subject: &str,
    ) -> StoreResult<Option<user::Model>> {
        self.inner.get_user_by_oauth(provider, subject).await
    }

    async fn upsert_oauth_user(
        &self,
        profile: OAuthProfile,
        bot: NewBot,
    ) -> StoreResult<user::Model> {
        let model = self.inner.upsert_oauth_user(profile, bot).await?;
        // The row changed (avatar / OAuth linkage / role) — drop the
        // cached entity so `SessionUser::from_model` (WS hubs,
        // AdminUser extractor) and any cached permission bundle see the
        // fresh state instead of the pre-link row until TTL.
        self.forget(model.id).await;
        Ok(model)
    }

    async fn delete_user(&self, id: Uuid) -> StoreResult<()> {
        let result = self.inner.delete_user(id).await;
        if result.is_ok() {
            let _ = self.cache.delete(&user_key(id)).await;
            let _ = self.cache.delete(&perms_key(id)).await;
        }
        result
    }

    async fn count_users(&self) -> StoreResult<u64> {
        self.inner.count_users().await
    }

    async fn list_users(&self, limit: u64, offset: u64) -> StoreResult<Vec<user::Model>> {
        // List queries aren't cached — they need fresh results every call.
        self.inner.list_users(limit, offset).await
    }

    async fn find_first_staff_member(&self) -> StoreResult<Option<user::Model>> {
        // Not cached — the first-employee answer is stable per deployment
        // but we don't want to cache in case an admin is demoted/deleted.
        self.inner.find_first_staff_member().await
    }

    async fn count_by_role(&self, role: &str) -> StoreResult<i64> {
        self.inner.count_by_role(role).await
    }

    async fn set_user_role(&self, user_id: Uuid, role: &str) -> StoreResult<user::Model> {
        let updated = self.inner.set_user_role(user_id, role).await?;
        // The `role` column changed — drop the cached entity row so
        // SessionUser::from_model (WS hubs, AdminUser extractor) sees
        // the fresh role instead of the stale cached copy until TTL.
        // The RBAC grant cache (`rbac:perms:{id}`) is already dropped
        // by CacheRbacStore on assign/revoke.
        let _ = self.cache.delete(&user_key(user_id)).await;
        let _ = self.cache.delete(&perms_key(user_id)).await;
        Ok(updated)
    }

    async fn register_account(&self, account: NewAccount, bot: NewBot) -> StoreResult<user::Model> {
        let model = self.inner.register_account(account, bot).await?;
        self.forget(model.id).await;
        Ok(model)
    }

    async fn find_account_by_email(&self, email: &str) -> StoreResult<Option<user::Model>> {
        self.inner.find_account_by_email(email).await
    }

    async fn find_account_by_phone(
        &self,
        spellings: &[String],
    ) -> StoreResult<Option<user::Model>> {
        self.inner.find_account_by_phone(spellings).await
    }

    async fn record_failed_login(
        &self,
        user_id: Uuid,
        max_failures: u32,
        lock_secs: u64,
    ) -> StoreResult<()> {
        self.inner
            .record_failed_login(user_id, max_failures, lock_secs)
            .await?;
        self.forget(user_id).await;
        Ok(())
    }

    async fn record_login_success(
        &self,
        user_id: Uuid,
        ip: Option<String>,
        rehash: Option<PasswordRehash>,
    ) -> StoreResult<()> {
        self.inner.record_login_success(user_id, ip, rehash).await?;
        self.forget(user_id).await;
        Ok(())
    }

    async fn change_password(&self, user_id: Uuid, hash: &str) -> StoreResult<()> {
        self.inner.change_password(user_id, hash).await?;
        self.forget(user_id).await;
        Ok(())
    }
}
