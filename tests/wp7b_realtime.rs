//! Chat and call parity, over real sockets.
//!
//! The whole application is booted on a local port (in-memory database,
//! the real router, middleware and hubs) and driven the way the web app
//! and the Flutter agent console drive it: REST for channels and
//! messages, `/ws` for chat events, `/ws-call` for call signaling.
//!
//! * a customer keeps one live (`open` or `assigned`) channel per brand;
//! * the staff queue lists newest activity first, then newest channel;
//! * a customer's `staff_presence` frame is `botActive` and nothing else;
//! * `/ws` greets with `hello` and answers `ping` with `pong`;
//! * both sockets are pinged by the server on the configured heartbeat;
//! * a call offer rings the agent with the caller's identity, and a
//!   phone woken by a push (a fresh socket registering mid-ring) is
//!   handed the ringing offer with the CALLER's id, not its own.
//!
//! One server (in its own runtime, so it outlives each test's) serves
//! every test, and the global hubs (presence, calls) are shared with it,
//! so the tests run one at a time and each starts from an empty roster.

use std::net::SocketAddr;
use std::sync::{Arc, Mutex as StdMutex, Once, OnceLock};
use std::time::Duration;

use futures::{SinkExt, StreamExt};
use sea_orm::{EntityTrait, Set};
use serde_json::{json, Value};
use tokio::sync::Mutex;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::Message;
use uuid::Uuid;

use backend::entity::brand;
use backend::service::auth_service::{LoginInput, RegisterInput, SessionContext, SessionKind};
use backend::state::AppState;

/// One test at a time: presence and the call hub are process-global.
static ONE_AT_A_TIME: Mutex<()> = Mutex::const_new(());

const PASSWORD: &str = "Sup3r-Secret-pw";
const BROWSER_UA: &str =
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) wp7b/1.0";
/// Server pings come this often in the tests (the production default is 30 s).
const HEARTBEAT_SEC: &str = "2";

// ────────────────────────────────────────────────────────────────
//  Harness
// ────────────────────────────────────────────────────────────────

struct Server {
    st: AppState,
    http: reqwest::Client,
    addr: SocketAddr,
}

struct Person {
    id: Uuid,
    name: String,
    token: String,
}

/// The one server of this process. It lives on a runtime of its own: a
/// test's runtime ends with the test, taking its server tasks (and their
/// hub clean-up) with it.
fn server() -> &'static Server {
    static SERVER: OnceLock<Server> = OnceLock::new();
    SERVER.get_or_init(|| {
        let (ready, booted) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            tokio::runtime::Runtime::new()
                .unwrap()
                .block_on(async move {
                    ready.send(boot().await).ok();
                    std::future::pending::<()>().await
                })
        });
        booted.recv().expect("server boot")
    })
}

/// Take the test lock and wait until the previous test's sockets are gone
/// from the hubs: no staff online in chat or calls.
async fn begin() -> (tokio::sync::MutexGuard<'static, ()>, &'static Server) {
    let guard = ONE_AT_A_TIME.lock().await;
    let srv = server();
    for _ in 0..100 {
        if backend::presence::presence().online_count(None) == 0
            && backend::audio_call::call_hub().online_agent_count() == 0
        {
            return (guard, srv);
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    panic!("the previous test left staff online");
}

async fn boot() -> Server {
    static ENV: Once = Once::new();
    ENV.call_once(|| {
        let _ = dotenvy::dotenv();
        std::env::set_var("DATABASE_URL", "sqlite::memory:");
        std::env::set_var("JWT_SECRET", "test-secret-at-least-32-bytes-long-aaaaaaaa");
        std::env::set_var("COOKIE_SECURE", "false");
        std::env::set_var("COOKIE_DOMAIN", "localhost");
        std::env::set_var("CACHE_BACKEND", "moka");
        std::env::set_var("WORKER_BACKEND", "db");
        std::env::set_var("SCHEDULER_ENABLED", "false");
        std::env::set_var("AUDIO_CALL_ENABLED", "true");
        std::env::set_var(
            "AUDIO_CALL_ICE_SERVERS",
            r#"[{"urls":["stun:stun.example.test:3478"]}]"#,
        );
        std::env::set_var("NULLCLAW_ENABLED", "false");
        std::env::set_var("VNPAY_ENABLED", "false");
        std::env::set_var("MOMO_ENABLED", "false");
        std::env::set_var("ZALOPAY_ENABLED", "false");
        std::env::set_var("VIETQR_ENABLED", "false");
        std::env::set_var("OAUTH_GOOGLE_ENABLED", "false");
        std::env::set_var("OAUTH_FACEBOOK_ENABLED", "false");
        std::env::set_var("WS_HEARTBEAT_SEC", HEARTBEAT_SEC);
        std::env::set_var("STORAGE_BACKEND", "local");
        std::env::set_var(
            "STORAGE_LOCAL_ROOT",
            std::env::temp_dir()
                .join(format!("wp7b-storage-{}", Uuid::new_v4()))
                .to_str()
                .unwrap(),
        );
        std::env::remove_var("STORAGE_PUBLIC_BASE_URL");
    });

    let st = backend::server::bootstrap().await.expect("bootstrap");
    let app = backend::routes::build_router(st.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind");
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(
            listener,
            app.into_make_service_with_connect_info::<SocketAddr>(),
        )
        .await
        .unwrap();
    });
    let srv = Server {
        st,
        http: reqwest::Client::builder()
            .user_agent(BROWSER_UA)
            .build()
            .unwrap(),
        addr,
    };
    // The first account of a server is its admin: make that one up front.
    srv.person("admin").await;
    srv
}

impl Server {
    /// A signed-in account. The FIRST one a server makes becomes its admin.
    async fn person(&self, role: &str) -> Person {
        let tag = Uuid::new_v4().simple().to_string();
        let email = format!("{role}-{tag}@wp7b.test");
        let user = self
            .st
            .auth
            .register(RegisterInput {
                full_name: format!("{role}-{tag}"),
                email: Some(email.clone()),
                phone: None,
                password: PASSWORD.into(),
                locale: None,
            })
            .await
            .expect("register");
        let user = match role {
            "employee" => self.st.users.set_role(user.id, "employee").await.unwrap(),
            _ => user,
        };
        let session = self
            .st
            .auth
            .login(
                LoginInput {
                    email: Some(email),
                    phone: None,
                    password: PASSWORD.into(),
                },
                SessionContext {
                    kind: SessionKind::Browser,
                    user_agent: None,
                    ip: None,
                },
            )
            .await
            .expect("login");
        Person {
            id: user.id,
            name: user.full_name,
            token: session.access_token,
        }
    }

    async fn brand(&self) -> Uuid {
        let id = Uuid::new_v4();
        let now = chrono::Utc::now().to_rfc3339();
        brand::Entity::insert(brand::ActiveModel {
            id: Set(id),
            slug: Set(format!("wp7b-{}", id.simple())),
            name: Set("Wp7b Coaches".into()),
            status: Set("active".into()),
            total_trips: Set(0),
            created_at: Set(now.clone()),
            updated_at: Set(now),
            ..Default::default()
        })
        .exec_without_returning(self.st.db.as_ref())
        .await
        .expect("brand");
        id
    }

    async fn post(&self, who: &Person, path: &str, body: Value) -> Value {
        let response = self
            .http
            .post(format!("http://{}{path}", self.addr))
            .bearer_auth(&who.token)
            .header("X-Client", "mobile")
            .json(&body)
            .send()
            .await
            .expect("request");
        let status = response.status();
        let text = response.text().await.unwrap();
        assert!(status.is_success(), "POST {path}: {status} {text}");
        serde_json::from_str(&text).unwrap_or(Value::Null)
    }

    async fn get(&self, who: &Person, path: &str) -> Value {
        let response = self
            .http
            .get(format!("http://{}{path}", self.addr))
            .bearer_auth(&who.token)
            .header("X-Client", "mobile")
            .send()
            .await
            .expect("request");
        let status = response.status();
        let text = response.text().await.unwrap();
        assert!(status.is_success(), "GET {path}: {status} {text}");
        serde_json::from_str(&text).unwrap()
    }

    /// The customer's support channel for `brand_id` (new, or the live one).
    async fn channel(&self, customer: &Person, brand_id: Option<Uuid>) -> Value {
        let body = self
            .post(
                customer,
                "/api/chat/channels",
                json!({ "topic": "help", "brandId": brand_id }),
            )
            .await;
        body["channel"].clone()
    }

    async fn say(&self, customer: &Person, channel_id: &str, text: &str) {
        self.post(
            customer,
            &format!("/api/chat/channels/{channel_id}/messages"),
            json!({ "content": text, "clientMsgId": Uuid::new_v4().to_string() }),
        )
        .await;
    }

    /// The staff queue, narrowed to `mine` (other tests' channels share it).
    async fn queue_of(&self, staff: &Person, mine: &[String]) -> Vec<String> {
        self.get(staff, "/api/chat/channels?limit=200").await["items"]
            .as_array()
            .unwrap()
            .iter()
            .map(|c| c["id"].as_str().unwrap().to_string())
            .filter(|id| mine.contains(id))
            .collect()
    }

    /// A socket on `path` (`/ws` or `/ws-call`), signed in by token.
    async fn socket(&self, who: &Person, path: &str) -> Socket {
        self.socket_as(who, path, BROWSER_UA).await
    }

    /// Like [`Server::socket`], from a client sending `user_agent`.
    async fn socket_as(&self, who: &Person, path: &str, user_agent: &str) -> Socket {
        let mut request = format!("ws://{}{path}?token={}", self.addr, who.token)
            .into_client_request()
            .unwrap();
        request
            .headers_mut()
            .insert("User-Agent", user_agent.parse().unwrap());
        let (stream, _) = tokio_tungstenite::connect_async(request)
            .await
            .expect("ws connect");
        let (mut sink, mut source) = stream.split();
        let seen: Arc<StdMutex<Vec<Seen>>> = Arc::default();
        let log = seen.clone();
        let (out_tx, mut out_rx) = tokio::sync::mpsc::unbounded_channel::<Value>();
        tokio::spawn(async move {
            loop {
                tokio::select! {
                    incoming = source.next() => match incoming {
                        Some(Ok(Message::Text(text))) => log
                            .lock()
                            .unwrap()
                            .push(Seen::Frame(serde_json::from_str(&text).unwrap())),
                        Some(Ok(Message::Ping(_))) => log.lock().unwrap().push(Seen::Ping),
                        Some(Ok(_)) => {}
                        _ => break,
                    },
                    outgoing = out_rx.recv() => match outgoing {
                        Some(frame) => {
                            if sink.send(Message::Text(frame.to_string().into())).await.is_err() {
                                break;
                            }
                        }
                        None => break,
                    },
                }
            }
        });
        Socket { seen, out: out_tx }
    }
}

enum Seen {
    Frame(Value),
    Ping,
}

/// A connected socket and everything it has received so far.
struct Socket {
    seen: Arc<StdMutex<Vec<Seen>>>,
    out: tokio::sync::mpsc::UnboundedSender<Value>,
}

impl Socket {
    fn send(&self, frame: Value) {
        self.out.send(frame).unwrap();
    }

    fn frames(&self) -> Vec<Value> {
        self.seen
            .lock()
            .unwrap()
            .iter()
            .filter_map(|s| match s {
                Seen::Frame(f) => Some(f.clone()),
                Seen::Ping => None,
            })
            .collect()
    }

    fn pings(&self) -> usize {
        self.seen
            .lock()
            .unwrap()
            .iter()
            .filter(|s| matches!(s, Seen::Ping))
            .count()
    }

    /// The first frame (so far, or within 3 s) that `pick` accepts.
    async fn wait_for(&self, what: &str, pick: impl Fn(&Value) -> bool) -> Value {
        for _ in 0..60 {
            if let Some(frame) = self.frames().into_iter().find(|f| pick(f)) {
                return frame;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        panic!("no {what} frame; got {:#?}", self.frames());
    }

    async fn wait_type(&self, ty: &str) -> Value {
        self.wait_for(ty, |f| f["type"] == ty).await
    }

    /// A staff_presence frame whose `botActive` is `bot_active`.
    async fn wait_bot_active(&self, bot_active: bool) -> Value {
        self.wait_for("staff_presence", |f| {
            f["type"] == "staff_presence" && f["botActive"] == bot_active
        })
        .await
    }
}

// ────────────────────────────────────────────────────────────────
//  Channels
// ────────────────────────────────────────────────────────────────

#[tokio::test]
async fn a_customer_keeps_one_live_channel_per_brand() {
    let (_one, srv) = begin().await;
    let staff = srv.person("employee").await;
    let customer = srv.person("user").await;
    let brand = srv.brand().await;

    // Asking again returns the channel that is already open.
    let first = srv.channel(&customer, None).await;
    assert_eq!(first["status"], "open");
    let again = srv.channel(&customer, None).await;
    assert_eq!(again["id"], first["id"]);

    // Once staff take the chat it is `assigned` — and asking STILL lands
    // in that conversation instead of starting a second one.
    let id = first["id"].as_str().unwrap();
    let claimed = srv
        .post(&staff, &format!("/api/chat/channels/{id}/claim"), json!({}))
        .await;
    assert_eq!(claimed["channel"]["status"], "assigned");
    let after_claim = srv.channel(&customer, None).await;
    assert_eq!(
        after_claim["id"], first["id"],
        "an assigned channel is reused"
    );
    assert_eq!(after_claim["status"], "assigned");

    // Another brand is another conversation, itself reused per brand.
    let branded = srv.channel(&customer, Some(brand)).await;
    assert_ne!(branded["id"], first["id"]);
    assert_eq!(branded["brandId"], brand.to_string());
    assert_eq!(
        srv.channel(&customer, Some(brand)).await["id"],
        branded["id"]
    );
    assert_eq!(srv.channel(&customer, None).await["id"], first["id"]);

    // Only a closed channel is left behind: the next ask starts afresh.
    srv.post(&staff, &format!("/api/chat/channels/{id}/close"), json!({}))
        .await;
    let fresh = srv.channel(&customer, None).await;
    assert_ne!(fresh["id"], first["id"]);
    assert_eq!(fresh["status"], "open");

    // The customer's own list shows exactly their three channels.
    let mine = srv.get(&customer, "/api/chat/channels").await;
    assert_eq!(mine["items"].as_array().unwrap().len(), 3);
}

/// With staff online, the channel is handed to the most available one the
/// moment it exists, and the answer says so; asking again finds it there.
#[tokio::test]
async fn a_channel_routed_at_creation_is_answered_and_reused_as_assigned() {
    let (_one, srv) = begin().await;
    let staff = srv.person("employee").await;
    let customer = srv.person("user").await;

    let staff_ws = srv.socket(&staff, "/ws").await;
    staff_ws
        .wait_for("the roster", |f| {
            f["type"] == "staff_presence" && f["staff"].is_array()
        })
        .await;

    let created = srv.channel(&customer, None).await;
    assert_eq!(created["status"], "assigned");
    assert_eq!(created["assignedTo"]["id"], staff.id.to_string());
    assert_eq!(created["user"]["id"], customer.id.to_string());

    let again = srv.channel(&customer, None).await;
    assert_eq!(again["id"], created["id"]);
    assert_eq!(again["status"], "assigned");
    assert_eq!(again["assignedTo"]["id"], staff.id.to_string());
}

#[tokio::test]
async fn a_stale_token_is_unauthorized_not_a_server_error() {
    let (_one, srv) = begin().await;
    let ghost = srv.person("user").await;
    srv.st.users.delete(ghost.id).await.expect("delete user");

    let response = srv
        .http
        .post(format!("http://{}/api/chat/channels", srv.addr))
        .bearer_auth(&ghost.token)
        .header("X-Client", "mobile")
        .json(&json!({}))
        .send()
        .await
        .unwrap();

    assert!(
        response.status().is_client_error(),
        "a deleted user's token must not 500: {}",
        response.status()
    );
}

#[tokio::test]
async fn the_staff_queue_lists_newest_activity_first_then_newest_channel() {
    let (_one, srv) = begin().await;
    let staff = srv.person("employee").await;

    // Three customers' channels, created a moment apart; nobody has written.
    let mut ids = Vec::new();
    let mut customers = Vec::new();
    for _ in 0..3 {
        let customer = srv.person("user").await;
        ids.push(
            srv.channel(&customer, None).await["id"]
                .as_str()
                .unwrap()
                .to_string(),
        );
        customers.push(customer);
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    let (oldest, middle, newest) = (&ids[0], &ids[1], &ids[2]);

    // With no message anywhere, the newest channel leads.
    assert_eq!(
        srv.queue_of(&staff, &ids).await,
        [newest.clone(), middle.clone(), oldest.clone()]
    );

    // A message moves a channel to the front, whatever its age.
    srv.say(&customers[0], oldest, "hello").await;
    assert_eq!(
        srv.queue_of(&staff, &ids).await,
        [oldest.clone(), newest.clone(), middle.clone()]
    );
    tokio::time::sleep(Duration::from_millis(20)).await;
    srv.say(&customers[1], middle, "hi").await;
    assert_eq!(
        srv.queue_of(&staff, &ids).await,
        [middle.clone(), oldest.clone(), newest.clone()]
    );
}

// ────────────────────────────────────────────────────────────────
//  Chat socket
// ────────────────────────────────────────────────────────────────

#[tokio::test]
async fn the_chat_socket_greets_answers_pings_and_pings_back() {
    let (_one, srv) = begin().await;
    let customer = srv.person("user").await;

    let socket = srv.socket(&customer, "/ws").await;
    let hello = socket.wait_type("hello").await;
    assert_eq!(hello["userId"], customer.id.to_string());
    assert_eq!(hello["name"], customer.name);
    assert_eq!(hello["role"], "user");

    socket.send(json!({ "type": "ping", "__client_ts": 1 }));
    socket.wait_type("pong").await;

    // The server pings on its own heartbeat (2 s here, 30 s by default,
    // never more than 50 s apart).
    tokio::time::sleep(Duration::from_millis(2600)).await;
    assert!(socket.pings() >= 1, "no server ping within the heartbeat");
}

/// The anti-scraping rules leave the socket hubs alone: a native client's
/// WebSocket stack announces itself however it likes.
#[tokio::test]
async fn the_sockets_accept_a_native_clients_user_agent() {
    let (_one, srv) = begin().await;
    let customer = srv.person("user").await;

    for user_agent in ["okhttp/4.12.0", "Dart/3.4 (dart:io)"] {
        let chat = srv.socket_as(&customer, "/ws", user_agent).await;
        chat.wait_type("hello").await;
    }
    srv.socket_as(&customer, "/ws-call", "okhttp/4.12.0").await;

    // The same client is still refused on the HTTP API.
    let refused = srv
        .http
        .get(format!("http://{}/api/chat/channels", srv.addr))
        .bearer_auth(&customer.token)
        .header("User-Agent", "okhttp/4.12.0")
        .send()
        .await
        .unwrap();
    assert_eq!(refused.status(), 403);
}

/// Two messages landing at once must both be counted: the counter moves in
/// one UPDATE, not read-then-write.
#[tokio::test]
async fn simultaneous_messages_all_count_as_unread() {
    let (_one, srv) = begin().await;
    let customer = srv.person("user").await;
    let brand_id = srv.brand().await;
    let channel = srv.channel(&customer, Some(brand_id)).await;
    let channel_id = channel["id"].as_str().unwrap().to_string();

    const MESSAGES: usize = 24;
    let bumps = (0..MESSAGES).map(|i| {
        let chats = srv.st.chats.clone();
        let channel_id = channel_id.clone();
        let side = if i % 2 == 0 { "employee" } else { "user" };
        async move { chats.increment_unread(&channel_id, side).await }
    });
    for result in futures::future::join_all(bumps).await {
        result.expect("increment");
    }

    let row =
        backend::entity::chat_channel::Entity::find_by_id(Uuid::parse_str(&channel_id).unwrap())
            .one(srv.st.db.as_ref())
            .await
            .unwrap()
            .unwrap();
    assert_eq!(row.unread_employee, (MESSAGES / 2) as i64);
    assert_eq!(row.unread_user, (MESSAGES / 2) as i64);
}

/// The web app and the mobile console both read the typer's `name`.
#[tokio::test]
async fn a_typing_frame_names_the_typist_as_the_clients_read_it() {
    let (_one, srv) = begin().await;
    let staff = srv.person("employee").await;
    let customer = srv.person("user").await;
    let channel = srv.channel(&customer, None).await["id"]
        .as_str()
        .unwrap()
        .to_string();

    let staff_ws = srv.socket(&staff, "/ws").await;
    let customer_ws = srv.socket(&customer, "/ws").await;
    for ws in [&staff_ws, &customer_ws] {
        ws.wait_type("hello").await;
        ws.send(json!({ "type": "join", "channelId": channel }));
        ws.wait_type("joined").await;
    }

    customer_ws.send(json!({ "type": "typing", "channelId": channel, "isTyping": true }));
    let typing = staff_ws.wait_type("typing").await;
    assert_eq!(typing["name"], customer.name);
    assert_eq!(typing["userId"], customer.id.to_string());
    assert_eq!(typing["channelId"], channel);
    assert_eq!(typing["isTyping"], true);
}

#[tokio::test]
async fn customers_hear_only_whether_the_bot_is_on_duty() {
    let (_one, srv) = begin().await;
    let staff = srv.person("employee").await;
    let customer = srv.person("user").await;

    let customer_ws = srv.socket(&customer, "/ws").await;
    customer_ws.wait_type("hello").await;

    // A staff member comes online: the customer is told the bot is off —
    // and gets nothing else about the roster.
    let staff_ws = srv.socket(&staff, "/ws").await;
    let to_customer = customer_ws.wait_bot_active(false).await;
    assert_eq!(
        to_customer,
        json!({ "type": "staff_presence", "botActive": false })
    );

    // Staff themselves get the full roster, with names, load and call state.
    let to_staff = staff_ws
        .wait_for("the roster", |f| {
            f["type"] == "staff_presence" && f["staff"].is_array()
        })
        .await;
    assert_eq!(to_staff["botActive"], false);
    assert_eq!(to_staff["onlineCount"], 1);
    assert_eq!(to_staff["staff"][0]["userId"], staff.id.to_string());

    // The last staff member leaves: the bot is back on duty.
    drop(staff_ws);
    customer_ws.wait_bot_active(true).await;

    // Over the whole exchange the customer never saw a roster.
    for frame in customer_ws.frames() {
        if frame["type"] == "staff_presence" {
            assert_eq!(
                frame.as_object().unwrap().len(),
                2,
                "customer frame carries more than botActive: {frame}"
            );
        }
    }
}

// ────────────────────────────────────────────────────────────────
//  Calls
// ────────────────────────────────────────────────────────────────

#[tokio::test]
async fn a_call_rings_the_agent_with_the_callers_identity_and_hangup_is_relayed() {
    let (_one, srv) = begin().await;
    let agent = srv.person("employee").await;
    let customer = srv.person("user").await;

    let agent_ws = srv.socket(&agent, "/ws-call").await;
    agent_ws.send(json!({ "type": "register", "role": "agent", "channelId": "ch-1" }));
    let registered = agent_ws.wait_type("registered").await;
    assert_eq!(registered["userId"], agent.id.to_string());
    assert_eq!(
        registered["iceServers"][0]["urls"][0], "stun:stun.example.test:3478",
        "the configured servers ride the registered frame"
    );

    let customer_ws = srv.socket(&customer, "/ws-call").await;
    customer_ws.send(json!({ "type": "register", "role": "customer", "channelId": "ch-1" }));
    customer_ws.wait_type("registered").await;
    customer_ws.send(json!({
        "type": "call", "to": "agent", "kind": "offer",
        "channelId": "ch-1",
        "sdp": { "type": "offer", "sdp": "v=0 fake-offer" },
    }));

    let incoming = agent_ws.wait_type("incoming").await;
    assert_eq!(incoming["from"], customer.id.to_string());
    assert_eq!(incoming["callerName"], customer.name);
    assert_eq!(incoming["kind"], "offer");
    assert_eq!(incoming["sdp"]["sdp"], "v=0 fake-offer");

    customer_ws.send(json!({ "type": "hangup", "to": "agent", "reason": "busy" }));
    let hangup = agent_ws.wait_type("hangup").await;
    assert_eq!(hangup["from"], customer.id.to_string());
}

/// #122: the phone woken by a VoIP push is a NEW socket. Registering
/// mid-ring, it is handed the still-ringing offer — from the CALLER, with
/// the caller's name — not an offer that looks like it came from itself.
#[tokio::test]
async fn a_push_woken_phone_gets_the_ringing_offer_with_the_callers_id() {
    let (_one, srv) = begin().await;
    let agent = srv.person("employee").await;
    let customer = srv.person("user").await;

    let first_ws = srv.socket(&agent, "/ws-call").await;
    first_ws.send(json!({ "type": "register", "role": "agent" }));
    first_ws.wait_type("registered").await;

    let customer_ws = srv.socket(&customer, "/ws-call").await;
    customer_ws.send(json!({ "type": "register", "role": "customer" }));
    customer_ws.wait_type("registered").await;
    customer_ws.send(json!({
        "type": "call", "to": "agent", "kind": "offer",
        "sdp": { "type": "offer", "sdp": "v=0 ring" },
    }));
    first_ws.wait_type("incoming").await;

    // The phone wakes and registers on a fresh socket while it still rings.
    let phone_ws = srv.socket(&agent, "/ws-call").await;
    phone_ws.send(json!({ "type": "register", "role": "agent" }));
    let registered = phone_ws.wait_type("registered").await;
    assert_eq!(registered["activeCall"]["state"], "ringing");
    let frames = phone_ws.frames();
    let registered_at = frames.iter().position(|f| f["type"] == "registered");
    let incoming_at = frames.iter().position(|f| f["type"] == "incoming");
    assert!(
        registered_at < incoming_at || incoming_at.is_none(),
        "clients reconcile on `registered` before they ring"
    );

    let incoming = phone_ws.wait_type("incoming").await;
    assert_eq!(incoming["from"], customer.id.to_string());
    assert_ne!(incoming["from"], agent.id.to_string());
    assert_eq!(incoming["callerName"], customer.name);
    assert_eq!(incoming["sdp"]["sdp"], "v=0 ring");
}

#[tokio::test]
async fn the_call_socket_is_pinged_on_the_heartbeat_too() {
    let (_one, srv) = begin().await;
    let agent = srv.person("employee").await;

    let socket = srv.socket(&agent, "/ws-call").await;
    socket.send(json!({ "type": "register", "role": "agent" }));
    socket.wait_type("registered").await;

    // The call socket's heartbeat never drops below 5 s.
    tokio::time::sleep(Duration::from_millis(5600)).await;
    assert!(socket.pings() >= 1, "no server ping within the heartbeat");
}
