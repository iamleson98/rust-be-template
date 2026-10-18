PRAGMA page_size=4096;
CREATE TABLE chat_message (
  id INTEGER PRIMARY KEY,
  channel_id INTEGER NOT NULL,
  sender_id INTEGER NOT NULL,
  client_msg_id TEXT,
  content TEXT NOT NULL,
  meta TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_chat_channel_time ON chat_message(channel_id, created_at);
CREATE TABLE notification (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  read_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_notif_user ON notification(user_id, created_at);
INSERT INTO chat_message (channel_id, sender_id, client_msg_id, content, meta, created_at)
VALUES (1, 1, 'cm-seed-1',
  'Xin chào, tôi muốn hỏi về chuyến xe đi Đà Nẵng tối nay còn vé không? Tôi cần 2 ghế hướng trước, gần cửa sổ nếu có thể. Cho tôi hỏi giá vé bao nhiêu và thời gian di chuyển dự kiến là bao lâu?',
  json_object('t','m','b',1,'f',1.5,'ed',false), '2026-01-01T00:00:00Z');
INSERT INTO notification (user_id, kind, payload, read_at, created_at)
VALUES (1, 'booking.confirmed',
  json_object('id','b0000001','code','DXV-100001','trip','Sài Gòn → Đà Nẵng','seats',json_array('A01','A02'),'amount',450000,'cur','VND'),
  NULL, '2026-01-01T00:00:00Z');
INSERT INTO chat_message (channel_id, sender_id, client_msg_id, content, meta, created_at)
SELECT (id*7919)%500+1, (id*104729)%10000+1,
  'cm-' || ((id*2654435761)%1000000000),
  printf('Xin chào, tôi muốn hỏi về chuyến xe %d đi Đà Nẵng lúc %02d:00, còn vé không? Tôi cần %d ghế hướng trước, gần cửa sổ nếu có thể. Cho tôi hỏi giá vé bao nhiêu và thời gian di chuyển dự kiến là bao lâu? Chuyến có dừng nghỉ ở trạm dọc không?',
    (id%50)+1, id%24, (id%4)+1),
  json_object('t','m','b',id%7,'f',1.5*(id%13),'ed',(id%2)=0,'r',printf('r-%d',id%997)),
  printf('2026-%02d-%02dT%02d:%02d:%02d.%03dZ',(id%12)+1,(id%28)+1,id%24,(id*7)%60,(id*11)%60,id%999)
FROM chat_message;

INSERT INTO chat_message (channel_id, sender_id, client_msg_id, content, meta, created_at)
SELECT (id*7919)%500+1, (id*104729)%10000+1,
  'cm-' || ((id*2654435761)%1000000000),
  printf('Xin chào, tôi muốn hỏi về chuyến xe %d đi Đà Nẵng lúc %02d:00, còn vé không? Tôi cần %d ghế hướng trước, gần cửa sổ nếu có thể. Cho tôi hỏi giá vé bao nhiêu và thời gian di chuyển dự kiến là bao lâu? Chuyến có dừng nghỉ ở trạm dọc không?',
    (id%50)+1, id%24, (id%4)+1),
  json_object('t','m','b',id%7,'f',1.5*(id%13),'ed',(id%2)=0,'r',printf('r-%d',id%997)),
  printf('2026-%02d-%02dT%02d:%02d:%02d.%03dZ',(id%12)+1,(id%28)+1,id%24,(id*7)%60,(id*11)%60,id%999)
FROM chat_message;

INSERT INTO chat_message (channel_id, sender_id, client_msg_id, content, meta, created_at)
SELECT (id*7919)%500+1, (id*104729)%10000+1,
  'cm-' || ((id*2654435761)%1000000000),
  printf('Xin chào, tôi muốn hỏi về chuyến xe %d đi Đà Nẵng lúc %02d:00, còn vé không? Tôi cần %d ghế hướng trước, gần cửa sổ nếu có thể. Cho tôi hỏi giá vé bao nhiêu và thời gian di chuyển dự kiến là bao lâu? Chuyến có dừng nghỉ ở trạm dọc không?',
    (id%50)+1, id%24, (id%4)+1),
  json_object('t','m','b',id%7,'f',1.5*(id%13),'ed',(id%2)=0,'r',printf('r-%d',id%997)),
  printf('2026-%02d-%02dT%02d:%02d:%02d.%03dZ',(id%12)+1,(id%28)+1,id%24,(id*7)%60,(id*11)%60,id%999)
FROM chat_message;

INSERT INTO chat_message (channel_id, sender_id, client_msg_id, content, meta, created_at)
SELECT (id*7919)%500+1, (id*104729)%10000+1,
  'cm-' || ((id*2654435761)%1000000000),
  printf('Xin chào, tôi muốn hỏi về chuyến xe %d đi Đà Nẵng lúc %02d:00, còn vé không? Tôi cần %d ghế hướng trước, gần cửa sổ nếu có thể. Cho tôi hỏi giá vé bao nhiêu và thời gian di chuyển dự kiến là bao lâu? Chuyến có dừng nghỉ ở trạm dọc không?',
    (id%50)+1, id%24, (id%4)+1),
  json_object('t','m','b',id%7,'f',1.5*(id%13),'ed',(id%2)=0,'r',printf('r-%d',id%997)),
  printf('2026-%02d-%02dT%02d:%02d:%02d.%03dZ',(id%12)+1,(id%28)+1,id%24,(id*7)%60,(id*11)%60,id%999)
FROM chat_message;

INSERT INTO chat_message (channel_id, sender_id, client_msg_id, content, meta, created_at)
SELECT (id*7919)%500+1, (id*104729)%10000+1,
  'cm-' || ((id*2654435761)%1000000000),
  printf('Xin chào, tôi muốn hỏi về chuyến xe %d đi Đà Nẵng lúc %02d:00, còn vé không? Tôi cần %d ghế hướng trước, gần cửa sổ nếu có thể. Cho tôi hỏi giá vé bao nhiêu và thời gian di chuyển dự kiến là bao lâu? Chuyến có dừng nghỉ ở trạm dọc không?',
    (id%50)+1, id%24, (id%4)+1),
  json_object('t','m','b',id%7,'f',1.5*(id%13),'ed',(id%2)=0,'r',printf('r-%d',id%997)),
  printf('2026-%02d-%02dT%02d:%02d:%02d.%03dZ',(id%12)+1,(id%28)+1,id%24,(id*7)%60,(id*11)%60,id%999)
FROM chat_message;

INSERT INTO chat_message (channel_id, sender_id, client_msg_id, content, meta, created_at)
SELECT (id*7919)%500+1, (id*104729)%10000+1,
  'cm-' || ((id*2654435761)%1000000000),
  printf('Xin chào, tôi muốn hỏi về chuyến xe %d đi Đà Nẵng lúc %02d:00, còn vé không? Tôi cần %d ghế hướng trước, gần cửa sổ nếu có thể. Cho tôi hỏi giá vé bao nhiêu và thời gian di chuyển dự kiến là bao lâu? Chuyến có dừng nghỉ ở trạm dọc không?',
    (id%50)+1, id%24, (id%4)+1),
  json_object('t','m','b',id%7,'f',1.5*(id%13),'ed',(id%2)=0,'r',printf('r-%d',id%997)),
  printf('2026-%02d-%02dT%02d:%02d:%02d.%03dZ',(id%12)+1,(id%28)+1,id%24,(id*7)%60,(id*11)%60,id%999)
FROM chat_message;

INSERT INTO chat_message (channel_id, sender_id, client_msg_id, content, meta, created_at)
SELECT (id*7919)%500+1, (id*104729)%10000+1,
  'cm-' || ((id*2654435761)%1000000000),
  printf('Xin chào, tôi muốn hỏi về chuyến xe %d đi Đà Nẵng lúc %02d:00, còn vé không? Tôi cần %d ghế hướng trước, gần cửa sổ nếu có thể. Cho tôi hỏi giá vé bao nhiêu và thời gian di chuyển dự kiến là bao lâu? Chuyến có dừng nghỉ ở trạm dọc không?',
    (id%50)+1, id%24, (id%4)+1),
  json_object('t','m','b',id%7,'f',1.5*(id%13),'ed',(id%2)=0,'r',printf('r-%d',id%997)),
  printf('2026-%02d-%02dT%02d:%02d:%02d.%03dZ',(id%12)+1,(id%28)+1,id%24,(id*7)%60,(id*11)%60,id%999)
FROM chat_message;

INSERT INTO chat_message (channel_id, sender_id, client_msg_id, content, meta, created_at)
SELECT (id*7919)%500+1, (id*104729)%10000+1,
  'cm-' || ((id*2654435761)%1000000000),
  printf('Xin chào, tôi muốn hỏi về chuyến xe %d đi Đà Nẵng lúc %02d:00, còn vé không? Tôi cần %d ghế hướng trước, gần cửa sổ nếu có thể. Cho tôi hỏi giá vé bao nhiêu và thời gian di chuyển dự kiến là bao lâu? Chuyến có dừng nghỉ ở trạm dọc không?',
    (id%50)+1, id%24, (id%4)+1),
  json_object('t','m','b',id%7,'f',1.5*(id%13),'ed',(id%2)=0,'r',printf('r-%d',id%997)),
  printf('2026-%02d-%02dT%02d:%02d:%02d.%03dZ',(id%12)+1,(id%28)+1,id%24,(id*7)%60,(id*11)%60,id%999)
FROM chat_message;

INSERT INTO chat_message (channel_id, sender_id, client_msg_id, content, meta, created_at)
SELECT (id*7919)%500+1, (id*104729)%10000+1,
  'cm-' || ((id*2654435761)%1000000000),
  printf('Xin chào, tôi muốn hỏi về chuyến xe %d đi Đà Nẵng lúc %02d:00, còn vé không? Tôi cần %d ghế hướng trước, gần cửa sổ nếu có thể. Cho tôi hỏi giá vé bao nhiêu và thời gian di chuyển dự kiến là bao lâu? Chuyến có dừng nghỉ ở trạm dọc không?',
    (id%50)+1, id%24, (id%4)+1),
  json_object('t','m','b',id%7,'f',1.5*(id%13),'ed',(id%2)=0,'r',printf('r-%d',id%997)),
  printf('2026-%02d-%02dT%02d:%02d:%02d.%03dZ',(id%12)+1,(id%28)+1,id%24,(id*7)%60,(id*11)%60,id%999)
FROM chat_message;

INSERT INTO chat_message (channel_id, sender_id, client_msg_id, content, meta, created_at)
SELECT (id*7919)%500+1, (id*104729)%10000+1,
  'cm-' || ((id*2654435761)%1000000000),
  printf('Xin chào, tôi muốn hỏi về chuyến xe %d đi Đà Nẵng lúc %02d:00, còn vé không? Tôi cần %d ghế hướng trước, gần cửa sổ nếu có thể. Cho tôi hỏi giá vé bao nhiêu và thời gian di chuyển dự kiến là bao lâu? Chuyến có dừng nghỉ ở trạm dọc không?',
    (id%50)+1, id%24, (id%4)+1),
  json_object('t','m','b',id%7,'f',1.5*(id%13),'ed',(id%2)=0,'r',printf('r-%d',id%997)),
  printf('2026-%02d-%02dT%02d:%02d:%02d.%03dZ',(id%12)+1,(id%28)+1,id%24,(id*7)%60,(id*11)%60,id%999)
FROM chat_message;

INSERT INTO chat_message (channel_id, sender_id, client_msg_id, content, meta, created_at)
SELECT (id*7919)%500+1, (id*104729)%10000+1,
  'cm-' || ((id*2654435761)%1000000000),
  printf('Xin chào, tôi muốn hỏi về chuyến xe %d đi Đà Nẵng lúc %02d:00, còn vé không? Tôi cần %d ghế hướng trước, gần cửa sổ nếu có thể. Cho tôi hỏi giá vé bao nhiêu và thời gian di chuyển dự kiến là bao lâu? Chuyến có dừng nghỉ ở trạm dọc không?',
    (id%50)+1, id%24, (id%4)+1),
  json_object('t','m','b',id%7,'f',1.5*(id%13),'ed',(id%2)=0,'r',printf('r-%d',id%997)),
  printf('2026-%02d-%02dT%02d:%02d:%02d.%03dZ',(id%12)+1,(id%28)+1,id%24,(id*7)%60,(id*11)%60,id%999)
FROM chat_message;

INSERT INTO chat_message (channel_id, sender_id, client_msg_id, content, meta, created_at)
SELECT (id*7919)%500+1, (id*104729)%10000+1,
  'cm-' || ((id*2654435761)%1000000000),
  printf('Xin chào, tôi muốn hỏi về chuyến xe %d đi Đà Nẵng lúc %02d:00, còn vé không? Tôi cần %d ghế hướng trước, gần cửa sổ nếu có thể. Cho tôi hỏi giá vé bao nhiêu và thời gian di chuyển dự kiến là bao lâu? Chuyến có dừng nghỉ ở trạm dọc không?',
    (id%50)+1, id%24, (id%4)+1),
  json_object('t','m','b',id%7,'f',1.5*(id%13),'ed',(id%2)=0,'r',printf('r-%d',id%997)),
  printf('2026-%02d-%02dT%02d:%02d:%02d.%03dZ',(id%12)+1,(id%28)+1,id%24,(id*7)%60,(id*11)%60,id%999)
FROM chat_message;

INSERT INTO chat_message (channel_id, sender_id, client_msg_id, content, meta, created_at)
SELECT (id*7919)%500+1, (id*104729)%10000+1,
  'cm-' || ((id*2654435761)%1000000000),
  printf('Xin chào, tôi muốn hỏi về chuyến xe %d đi Đà Nẵng lúc %02d:00, còn vé không? Tôi cần %d ghế hướng trước, gần cửa sổ nếu có thể. Cho tôi hỏi giá vé bao nhiêu và thời gian di chuyển dự kiến là bao lâu? Chuyến có dừng nghỉ ở trạm dọc không?',
    (id%50)+1, id%24, (id%4)+1),
  json_object('t','m','b',id%7,'f',1.5*(id%13),'ed',(id%2)=0,'r',printf('r-%d',id%997)),
  printf('2026-%02d-%02dT%02d:%02d:%02d.%03dZ',(id%12)+1,(id%28)+1,id%24,(id*7)%60,(id*11)%60,id%999)
FROM chat_message;

INSERT INTO chat_message (channel_id, sender_id, client_msg_id, content, meta, created_at)
SELECT (id*7919)%500+1, (id*104729)%10000+1,
  'cm-' || ((id*2654435761)%1000000000),
  printf('Xin chào, tôi muốn hỏi về chuyến xe %d đi Đà Nẵng lúc %02d:00, còn vé không? Tôi cần %d ghế hướng trước, gần cửa sổ nếu có thể. Cho tôi hỏi giá vé bao nhiêu và thời gian di chuyển dự kiến là bao lâu? Chuyến có dừng nghỉ ở trạm dọc không?',
    (id%50)+1, id%24, (id%4)+1),
  json_object('t','m','b',id%7,'f',1.5*(id%13),'ed',(id%2)=0,'r',printf('r-%d',id%997)),
  printf('2026-%02d-%02dT%02d:%02d:%02d.%03dZ',(id%12)+1,(id%28)+1,id%24,(id*7)%60,(id*11)%60,id%999)
FROM chat_message;

INSERT INTO chat_message (channel_id, sender_id, client_msg_id, content, meta, created_at)
SELECT (id*7919)%500+1, (id*104729)%10000+1,
  'cm-' || ((id*2654435761)%1000000000),
  printf('Xin chào, tôi muốn hỏi về chuyến xe %d đi Đà Nẵng lúc %02d:00, còn vé không? Tôi cần %d ghế hướng trước, gần cửa sổ nếu có thể. Cho tôi hỏi giá vé bao nhiêu và thời gian di chuyển dự kiến là bao lâu? Chuyến có dừng nghỉ ở trạm dọc không?',
    (id%50)+1, id%24, (id%4)+1),
  json_object('t','m','b',id%7,'f',1.5*(id%13),'ed',(id%2)=0,'r',printf('r-%d',id%997)),
  printf('2026-%02d-%02dT%02d:%02d:%02d.%03dZ',(id%12)+1,(id%28)+1,id%24,(id*7)%60,(id*11)%60,id%999)
FROM chat_message;

INSERT INTO chat_message (channel_id, sender_id, client_msg_id, content, meta, created_at)
SELECT (id*7919)%500+1, (id*104729)%10000+1,
  'cm-' || ((id*2654435761)%1000000000),
  printf('Xin chào, tôi muốn hỏi về chuyến xe %d đi Đà Nẵng lúc %02d:00, còn vé không? Tôi cần %d ghế hướng trước, gần cửa sổ nếu có thể. Cho tôi hỏi giá vé bao nhiêu và thời gian di chuyển dự kiến là bao lâu? Chuyến có dừng nghỉ ở trạm dọc không?',
    (id%50)+1, id%24, (id%4)+1),
  json_object('t','m','b',id%7,'f',1.5*(id%13),'ed',(id%2)=0,'r',printf('r-%d',id%997)),
  printf('2026-%02d-%02dT%02d:%02d:%02d.%03dZ',(id%12)+1,(id%28)+1,id%24,(id*7)%60,(id*11)%60,id%999)
FROM chat_message;

INSERT INTO chat_message (channel_id, sender_id, client_msg_id, content, meta, created_at)
SELECT (id*7919)%500+1, (id*104729)%10000+1,
  'cm-' || ((id*2654435761)%1000000000),
  printf('Xin chào, tôi muốn hỏi về chuyến xe %d đi Đà Nẵng lúc %02d:00, còn vé không? Tôi cần %d ghế hướng trước, gần cửa sổ nếu có thể. Cho tôi hỏi giá vé bao nhiêu và thời gian di chuyển dự kiến là bao lâu? Chuyến có dừng nghỉ ở trạm dọc không?',
    (id%50)+1, id%24, (id%4)+1),
  json_object('t','m','b',id%7,'f',1.5*(id%13),'ed',(id%2)=0,'r',printf('r-%d',id%997)),
  printf('2026-%02d-%02dT%02d:%02d:%02d.%03dZ',(id%12)+1,(id%28)+1,id%24,(id*7)%60,(id*11)%60,id%999)
FROM chat_message;

INSERT INTO chat_message (channel_id, sender_id, client_msg_id, content, meta, created_at)
SELECT (id*7919)%500+1, (id*104729)%10000+1,
  'cm-' || ((id*2654435761)%1000000000),
  printf('Xin chào, tôi muốn hỏi về chuyến xe %d đi Đà Nẵng lúc %02d:00, còn vé không? Tôi cần %d ghế hướng trước, gần cửa sổ nếu có thể. Cho tôi hỏi giá vé bao nhiêu và thời gian di chuyển dự kiến là bao lâu? Chuyến có dừng nghỉ ở trạm dọc không?',
    (id%50)+1, id%24, (id%4)+1),
  json_object('t','m','b',id%7,'f',1.5*(id%13),'ed',(id%2)=0,'r',printf('r-%d',id%997)),
  printf('2026-%02d-%02dT%02d:%02d:%02d.%03dZ',(id%12)+1,(id%28)+1,id%24,(id*7)%60,(id*11)%60,id%999)
FROM chat_message;

INSERT INTO chat_message (channel_id, sender_id, client_msg_id, content, meta, created_at)
SELECT (id*7919)%500+1, (id*104729)%10000+1,
  'cm-' || ((id*2654435761)%1000000000),
  printf('Xin chào, tôi muốn hỏi về chuyến xe %d đi Đà Nẵng lúc %02d:00, còn vé không? Tôi cần %d ghế hướng trước, gần cửa sổ nếu có thể. Cho tôi hỏi giá vé bao nhiêu và thời gian di chuyển dự kiến là bao lâu? Chuyến có dừng nghỉ ở trạm dọc không?',
    (id%50)+1, id%24, (id%4)+1),
  json_object('t','m','b',id%7,'f',1.5*(id%13),'ed',(id%2)=0,'r',printf('r-%d',id%997)),
  printf('2026-%02d-%02dT%02d:%02d:%02d.%03dZ',(id%12)+1,(id%28)+1,id%24,(id*7)%60,(id*11)%60,id%999)
FROM chat_message;

INSERT INTO notification (user_id, kind, payload, read_at, created_at)
SELECT (id*7919)%10000+1,
  CASE id%5 WHEN 0 THEN 'booking.confirmed' WHEN 1 THEN 'booking.reminder' WHEN 2 THEN 'promo' WHEN 3 THEN 'chat.new_message' ELSE 'system' END,
  json_object('id',printf('b%07d',id),'code',printf('DXV-%d',100000+id),'trip',CASE id%4 WHEN 0 THEN 'Sài Gòn → Đà Nẵng' WHEN 1 THEN 'Hà Nội → Huế' WHEN 2 THEN 'Đà Nẵng → Nha Trang' ELSE 'Cần Thơ → Sài Gòn' END,'seats',json_array(printf('A%02d',id%40+1),printf('B%02d',id%30+1)),'amount',450000+id%550000,'cur','VND','ch',printf('ch-%d',id%500)),
  CASE WHEN id%3=0 THEN printf('2026-%02d-%02dT%02d:00:00Z',(id%12)+1,(id%28)+1,id%24) ELSE NULL END,
  printf('2026-%02d-%02dT%02d:%02d:%02d.%03dZ',(id%12)+1,(id%28)+1,id%24,(id*7)%60,(id*11)%60,id%999)
FROM notification;

INSERT INTO notification (user_id, kind, payload, read_at, created_at)
SELECT (id*7919)%10000+1,
  CASE id%5 WHEN 0 THEN 'booking.confirmed' WHEN 1 THEN 'booking.reminder' WHEN 2 THEN 'promo' WHEN 3 THEN 'chat.new_message' ELSE 'system' END,
  json_object('id',printf('b%07d',id),'code',printf('DXV-%d',100000+id),'trip',CASE id%4 WHEN 0 THEN 'Sài Gòn → Đà Nẵng' WHEN 1 THEN 'Hà Nội → Huế' WHEN 2 THEN 'Đà Nẵng → Nha Trang' ELSE 'Cần Thơ → Sài Gòn' END,'seats',json_array(printf('A%02d',id%40+1),printf('B%02d',id%30+1)),'amount',450000+id%550000,'cur','VND','ch',printf('ch-%d',id%500)),
  CASE WHEN id%3=0 THEN printf('2026-%02d-%02dT%02d:00:00Z',(id%12)+1,(id%28)+1,id%24) ELSE NULL END,
  printf('2026-%02d-%02dT%02d:%02d:%02d.%03dZ',(id%12)+1,(id%28)+1,id%24,(id*7)%60,(id*11)%60,id%999)
FROM notification;

INSERT INTO notification (user_id, kind, payload, read_at, created_at)
SELECT (id*7919)%10000+1,
  CASE id%5 WHEN 0 THEN 'booking.confirmed' WHEN 1 THEN 'booking.reminder' WHEN 2 THEN 'promo' WHEN 3 THEN 'chat.new_message' ELSE 'system' END,
  json_object('id',printf('b%07d',id),'code',printf('DXV-%d',100000+id),'trip',CASE id%4 WHEN 0 THEN 'Sài Gòn → Đà Nẵng' WHEN 1 THEN 'Hà Nội → Huế' WHEN 2 THEN 'Đà Nẵng → Nha Trang' ELSE 'Cần Thơ → Sài Gòn' END,'seats',json_array(printf('A%02d',id%40+1),printf('B%02d',id%30+1)),'amount',450000+id%550000,'cur','VND','ch',printf('ch-%d',id%500)),
  CASE WHEN id%3=0 THEN printf('2026-%02d-%02dT%02d:00:00Z',(id%12)+1,(id%28)+1,id%24) ELSE NULL END,
  printf('2026-%02d-%02dT%02d:%02d:%02d.%03dZ',(id%12)+1,(id%28)+1,id%24,(id*7)%60,(id*11)%60,id%999)
FROM notification;

INSERT INTO notification (user_id, kind, payload, read_at, created_at)
SELECT (id*7919)%10000+1,
  CASE id%5 WHEN 0 THEN 'booking.confirmed' WHEN 1 THEN 'booking.reminder' WHEN 2 THEN 'promo' WHEN 3 THEN 'chat.new_message' ELSE 'system' END,
  json_object('id',printf('b%07d',id),'code',printf('DXV-%d',100000+id),'trip',CASE id%4 WHEN 0 THEN 'Sài Gòn → Đà Nẵng' WHEN 1 THEN 'Hà Nội → Huế' WHEN 2 THEN 'Đà Nẵng → Nha Trang' ELSE 'Cần Thơ → Sài Gòn' END,'seats',json_array(printf('A%02d',id%40+1),printf('B%02d',id%30+1)),'amount',450000+id%550000,'cur','VND','ch',printf('ch-%d',id%500)),
  CASE WHEN id%3=0 THEN printf('2026-%02d-%02dT%02d:00:00Z',(id%12)+1,(id%28)+1,id%24) ELSE NULL END,
  printf('2026-%02d-%02dT%02d:%02d:%02d.%03dZ',(id%12)+1,(id%28)+1,id%24,(id*7)%60,(id*11)%60,id%999)
FROM notification;

INSERT INTO notification (user_id, kind, payload, read_at, created_at)
SELECT (id*7919)%10000+1,
  CASE id%5 WHEN 0 THEN 'booking.confirmed' WHEN 1 THEN 'booking.reminder' WHEN 2 THEN 'promo' WHEN 3 THEN 'chat.new_message' ELSE 'system' END,
  json_object('id',printf('b%07d',id),'code',printf('DXV-%d',100000+id),'trip',CASE id%4 WHEN 0 THEN 'Sài Gòn → Đà Nẵng' WHEN 1 THEN 'Hà Nội → Huế' WHEN 2 THEN 'Đà Nẵng → Nha Trang' ELSE 'Cần Thơ → Sài Gòn' END,'seats',json_array(printf('A%02d',id%40+1),printf('B%02d',id%30+1)),'amount',450000+id%550000,'cur','VND','ch',printf('ch-%d',id%500)),
  CASE WHEN id%3=0 THEN printf('2026-%02d-%02dT%02d:00:00Z',(id%12)+1,(id%28)+1,id%24) ELSE NULL END,
  printf('2026-%02d-%02dT%02d:%02d:%02d.%03dZ',(id%12)+1,(id%28)+1,id%24,(id*7)%60,(id*11)%60,id%999)
FROM notification;

INSERT INTO notification (user_id, kind, payload, read_at, created_at)
SELECT (id*7919)%10000+1,
  CASE id%5 WHEN 0 THEN 'booking.confirmed' WHEN 1 THEN 'booking.reminder' WHEN 2 THEN 'promo' WHEN 3 THEN 'chat.new_message' ELSE 'system' END,
  json_object('id',printf('b%07d',id),'code',printf('DXV-%d',100000+id),'trip',CASE id%4 WHEN 0 THEN 'Sài Gòn → Đà Nẵng' WHEN 1 THEN 'Hà Nội → Huế' WHEN 2 THEN 'Đà Nẵng → Nha Trang' ELSE 'Cần Thơ → Sài Gòn' END,'seats',json_array(printf('A%02d',id%40+1),printf('B%02d',id%30+1)),'amount',450000+id%550000,'cur','VND','ch',printf('ch-%d',id%500)),
  CASE WHEN id%3=0 THEN printf('2026-%02d-%02dT%02d:00:00Z',(id%12)+1,(id%28)+1,id%24) ELSE NULL END,
  printf('2026-%02d-%02dT%02d:%02d:%02d.%03dZ',(id%12)+1,(id%28)+1,id%24,(id*7)%60,(id*11)%60,id%999)
FROM notification;

INSERT INTO notification (user_id, kind, payload, read_at, created_at)
SELECT (id*7919)%10000+1,
  CASE id%5 WHEN 0 THEN 'booking.confirmed' WHEN 1 THEN 'booking.reminder' WHEN 2 THEN 'promo' WHEN 3 THEN 'chat.new_message' ELSE 'system' END,
  json_object('id',printf('b%07d',id),'code',printf('DXV-%d',100000+id),'trip',CASE id%4 WHEN 0 THEN 'Sài Gòn → Đà Nẵng' WHEN 1 THEN 'Hà Nội → Huế' WHEN 2 THEN 'Đà Nẵng → Nha Trang' ELSE 'Cần Thơ → Sài Gòn' END,'seats',json_array(printf('A%02d',id%40+1),printf('B%02d',id%30+1)),'amount',450000+id%550000,'cur','VND','ch',printf('ch-%d',id%500)),
  CASE WHEN id%3=0 THEN printf('2026-%02d-%02dT%02d:00:00Z',(id%12)+1,(id%28)+1,id%24) ELSE NULL END,
  printf('2026-%02d-%02dT%02d:%02d:%02d.%03dZ',(id%12)+1,(id%28)+1,id%24,(id*7)%60,(id*11)%60,id%999)
FROM notification;

INSERT INTO notification (user_id, kind, payload, read_at, created_at)
SELECT (id*7919)%10000+1,
  CASE id%5 WHEN 0 THEN 'booking.confirmed' WHEN 1 THEN 'booking.reminder' WHEN 2 THEN 'promo' WHEN 3 THEN 'chat.new_message' ELSE 'system' END,
  json_object('id',printf('b%07d',id),'code',printf('DXV-%d',100000+id),'trip',CASE id%4 WHEN 0 THEN 'Sài Gòn → Đà Nẵng' WHEN 1 THEN 'Hà Nội → Huế' WHEN 2 THEN 'Đà Nẵng → Nha Trang' ELSE 'Cần Thơ → Sài Gòn' END,'seats',json_array(printf('A%02d',id%40+1),printf('B%02d',id%30+1)),'amount',450000+id%550000,'cur','VND','ch',printf('ch-%d',id%500)),
  CASE WHEN id%3=0 THEN printf('2026-%02d-%02dT%02d:00:00Z',(id%12)+1,(id%28)+1,id%24) ELSE NULL END,
  printf('2026-%02d-%02dT%02d:%02d:%02d.%03dZ',(id%12)+1,(id%28)+1,id%24,(id*7)%60,(id*11)%60,id%999)
FROM notification;

INSERT INTO notification (user_id, kind, payload, read_at, created_at)
SELECT (id*7919)%10000+1,
  CASE id%5 WHEN 0 THEN 'booking.confirmed' WHEN 1 THEN 'booking.reminder' WHEN 2 THEN 'promo' WHEN 3 THEN 'chat.new_message' ELSE 'system' END,
  json_object('id',printf('b%07d',id),'code',printf('DXV-%d',100000+id),'trip',CASE id%4 WHEN 0 THEN 'Sài Gòn → Đà Nẵng' WHEN 1 THEN 'Hà Nội → Huế' WHEN 2 THEN 'Đà Nẵng → Nha Trang' ELSE 'Cần Thơ → Sài Gòn' END,'seats',json_array(printf('A%02d',id%40+1),printf('B%02d',id%30+1)),'amount',450000+id%550000,'cur','VND','ch',printf('ch-%d',id%500)),
  CASE WHEN id%3=0 THEN printf('2026-%02d-%02dT%02d:00:00Z',(id%12)+1,(id%28)+1,id%24) ELSE NULL END,
  printf('2026-%02d-%02dT%02d:%02d:%02d.%03dZ',(id%12)+1,(id%28)+1,id%24,(id*7)%60,(id*11)%60,id%999)
FROM notification;

INSERT INTO notification (user_id, kind, payload, read_at, created_at)
SELECT (id*7919)%10000+1,
  CASE id%5 WHEN 0 THEN 'booking.confirmed' WHEN 1 THEN 'booking.reminder' WHEN 2 THEN 'promo' WHEN 3 THEN 'chat.new_message' ELSE 'system' END,
  json_object('id',printf('b%07d',id),'code',printf('DXV-%d',100000+id),'trip',CASE id%4 WHEN 0 THEN 'Sài Gòn → Đà Nẵng' WHEN 1 THEN 'Hà Nội → Huế' WHEN 2 THEN 'Đà Nẵng → Nha Trang' ELSE 'Cần Thơ → Sài Gòn' END,'seats',json_array(printf('A%02d',id%40+1),printf('B%02d',id%30+1)),'amount',450000+id%550000,'cur','VND','ch',printf('ch-%d',id%500)),
  CASE WHEN id%3=0 THEN printf('2026-%02d-%02dT%02d:00:00Z',(id%12)+1,(id%28)+1,id%24) ELSE NULL END,
  printf('2026-%02d-%02dT%02d:%02d:%02d.%03dZ',(id%12)+1,(id%28)+1,id%24,(id*7)%60,(id*11)%60,id%999)
FROM notification;

INSERT INTO notification (user_id, kind, payload, read_at, created_at)
SELECT (id*7919)%10000+1,
  CASE id%5 WHEN 0 THEN 'booking.confirmed' WHEN 1 THEN 'booking.reminder' WHEN 2 THEN 'promo' WHEN 3 THEN 'chat.new_message' ELSE 'system' END,
  json_object('id',printf('b%07d',id),'code',printf('DXV-%d',100000+id),'trip',CASE id%4 WHEN 0 THEN 'Sài Gòn → Đà Nẵng' WHEN 1 THEN 'Hà Nội → Huế' WHEN 2 THEN 'Đà Nẵng → Nha Trang' ELSE 'Cần Thơ → Sài Gòn' END,'seats',json_array(printf('A%02d',id%40+1),printf('B%02d',id%30+1)),'amount',450000+id%550000,'cur','VND','ch',printf('ch-%d',id%500)),
  CASE WHEN id%3=0 THEN printf('2026-%02d-%02dT%02d:00:00Z',(id%12)+1,(id%28)+1,id%24) ELSE NULL END,
  printf('2026-%02d-%02dT%02d:%02d:%02d.%03dZ',(id%12)+1,(id%28)+1,id%24,(id*7)%60,(id*11)%60,id%999)
FROM notification;

INSERT INTO notification (user_id, kind, payload, read_at, created_at)
SELECT (id*7919)%10000+1,
  CASE id%5 WHEN 0 THEN 'booking.confirmed' WHEN 1 THEN 'booking.reminder' WHEN 2 THEN 'promo' WHEN 3 THEN 'chat.new_message' ELSE 'system' END,
  json_object('id',printf('b%07d',id),'code',printf('DXV-%d',100000+id),'trip',CASE id%4 WHEN 0 THEN 'Sài Gòn → Đà Nẵng' WHEN 1 THEN 'Hà Nội → Huế' WHEN 2 THEN 'Đà Nẵng → Nha Trang' ELSE 'Cần Thơ → Sài Gòn' END,'seats',json_array(printf('A%02d',id%40+1),printf('B%02d',id%30+1)),'amount',450000+id%550000,'cur','VND','ch',printf('ch-%d',id%500)),
  CASE WHEN id%3=0 THEN printf('2026-%02d-%02dT%02d:00:00Z',(id%12)+1,(id%28)+1,id%24) ELSE NULL END,
  printf('2026-%02d-%02dT%02d:%02d:%02d.%03dZ',(id%12)+1,(id%28)+1,id%24,(id*7)%60,(id*11)%60,id%999)
FROM notification;

INSERT INTO notification (user_id, kind, payload, read_at, created_at)
SELECT (id*7919)%10000+1,
  CASE id%5 WHEN 0 THEN 'booking.confirmed' WHEN 1 THEN 'booking.reminder' WHEN 2 THEN 'promo' WHEN 3 THEN 'chat.new_message' ELSE 'system' END,
  json_object('id',printf('b%07d',id),'code',printf('DXV-%d',100000+id),'trip',CASE id%4 WHEN 0 THEN 'Sài Gòn → Đà Nẵng' WHEN 1 THEN 'Hà Nội → Huế' WHEN 2 THEN 'Đà Nẵng → Nha Trang' ELSE 'Cần Thơ → Sài Gòn' END,'seats',json_array(printf('A%02d',id%40+1),printf('B%02d',id%30+1)),'amount',450000+id%550000,'cur','VND','ch',printf('ch-%d',id%500)),
  CASE WHEN id%3=0 THEN printf('2026-%02d-%02dT%02d:00:00Z',(id%12)+1,(id%28)+1,id%24) ELSE NULL END,
  printf('2026-%02d-%02dT%02d:%02d:%02d.%03dZ',(id%12)+1,(id%28)+1,id%24,(id*7)%60,(id*11)%60,id%999)
FROM notification;

INSERT INTO notification (user_id, kind, payload, read_at, created_at)
SELECT (id*7919)%10000+1,
  CASE id%5 WHEN 0 THEN 'booking.confirmed' WHEN 1 THEN 'booking.reminder' WHEN 2 THEN 'promo' WHEN 3 THEN 'chat.new_message' ELSE 'system' END,
  json_object('id',printf('b%07d',id),'code',printf('DXV-%d',100000+id),'trip',CASE id%4 WHEN 0 THEN 'Sài Gòn → Đà Nẵng' WHEN 1 THEN 'Hà Nội → Huế' WHEN 2 THEN 'Đà Nẵng → Nha Trang' ELSE 'Cần Thơ → Sài Gòn' END,'seats',json_array(printf('A%02d',id%40+1),printf('B%02d',id%30+1)),'amount',450000+id%550000,'cur','VND','ch',printf('ch-%d',id%500)),
  CASE WHEN id%3=0 THEN printf('2026-%02d-%02dT%02d:00:00Z',(id%12)+1,(id%28)+1,id%24) ELSE NULL END,
  printf('2026-%02d-%02dT%02d:%02d:%02d.%03dZ',(id%12)+1,(id%28)+1,id%24,(id*7)%60,(id*11)%60,id%999)
FROM notification;

INSERT INTO notification (user_id, kind, payload, read_at, created_at)
SELECT (id*7919)%10000+1,
  CASE id%5 WHEN 0 THEN 'booking.confirmed' WHEN 1 THEN 'booking.reminder' WHEN 2 THEN 'promo' WHEN 3 THEN 'chat.new_message' ELSE 'system' END,
  json_object('id',printf('b%07d',id),'code',printf('DXV-%d',100000+id),'trip',CASE id%4 WHEN 0 THEN 'Sài Gòn → Đà Nẵng' WHEN 1 THEN 'Hà Nội → Huế' WHEN 2 THEN 'Đà Nẵng → Nha Trang' ELSE 'Cần Thơ → Sài Gòn' END,'seats',json_array(printf('A%02d',id%40+1),printf('B%02d',id%30+1)),'amount',450000+id%550000,'cur','VND','ch',printf('ch-%d',id%500)),
  CASE WHEN id%3=0 THEN printf('2026-%02d-%02dT%02d:00:00Z',(id%12)+1,(id%28)+1,id%24) ELSE NULL END,
  printf('2026-%02d-%02dT%02d:%02d:%02d.%03dZ',(id%12)+1,(id%28)+1,id%24,(id*7)%60,(id*11)%60,id%999)
FROM notification;

INSERT INTO notification (user_id, kind, payload, read_at, created_at)
SELECT (id*7919)%10000+1,
  CASE id%5 WHEN 0 THEN 'booking.confirmed' WHEN 1 THEN 'booking.reminder' WHEN 2 THEN 'promo' WHEN 3 THEN 'chat.new_message' ELSE 'system' END,
  json_object('id',printf('b%07d',id),'code',printf('DXV-%d',100000+id),'trip',CASE id%4 WHEN 0 THEN 'Sài Gòn → Đà Nẵng' WHEN 1 THEN 'Hà Nội → Huế' WHEN 2 THEN 'Đà Nẵng → Nha Trang' ELSE 'Cần Thơ → Sài Gòn' END,'seats',json_array(printf('A%02d',id%40+1),printf('B%02d',id%30+1)),'amount',450000+id%550000,'cur','VND','ch',printf('ch-%d',id%500)),
  CASE WHEN id%3=0 THEN printf('2026-%02d-%02dT%02d:00:00Z',(id%12)+1,(id%28)+1,id%24) ELSE NULL END,
  printf('2026-%02d-%02dT%02d:%02d:%02d.%03dZ',(id%12)+1,(id%28)+1,id%24,(id*7)%60,(id*11)%60,id%999)
FROM notification;

INSERT INTO notification (user_id, kind, payload, read_at, created_at)
SELECT (id*7919)%10000+1,
  CASE id%5 WHEN 0 THEN 'booking.confirmed' WHEN 1 THEN 'booking.reminder' WHEN 2 THEN 'promo' WHEN 3 THEN 'chat.new_message' ELSE 'system' END,
  json_object('id',printf('b%07d',id),'code',printf('DXV-%d',100000+id),'trip',CASE id%4 WHEN 0 THEN 'Sài Gòn → Đà Nẵng' WHEN 1 THEN 'Hà Nội → Huế' WHEN 2 THEN 'Đà Nẵng → Nha Trang' ELSE 'Cần Thơ → Sài Gòn' END,'seats',json_array(printf('A%02d',id%40+1),printf('B%02d',id%30+1)),'amount',450000+id%550000,'cur','VND','ch',printf('ch-%d',id%500)),
  CASE WHEN id%3=0 THEN printf('2026-%02d-%02dT%02d:00:00Z',(id%12)+1,(id%28)+1,id%24) ELSE NULL END,
  printf('2026-%02d-%02dT%02d:%02d:%02d.%03dZ',(id%12)+1,(id%28)+1,id%24,(id*7)%60,(id*11)%60,id%999)
FROM notification;

INSERT INTO notification (user_id, kind, payload, read_at, created_at)
SELECT (id*7919)%10000+1,
  CASE id%5 WHEN 0 THEN 'booking.confirmed' WHEN 1 THEN 'booking.reminder' WHEN 2 THEN 'promo' WHEN 3 THEN 'chat.new_message' ELSE 'system' END,
  json_object('id',printf('b%07d',id),'code',printf('DXV-%d',100000+id),'trip',CASE id%4 WHEN 0 THEN 'Sài Gòn → Đà Nẵng' WHEN 1 THEN 'Hà Nội → Huế' WHEN 2 THEN 'Đà Nẵng → Nha Trang' ELSE 'Cần Thơ → Sài Gòn' END,'seats',json_array(printf('A%02d',id%40+1),printf('B%02d',id%30+1)),'amount',450000+id%550000,'cur','VND','ch',printf('ch-%d',id%500)),
  CASE WHEN id%3=0 THEN printf('2026-%02d-%02dT%02d:00:00Z',(id%12)+1,(id%28)+1,id%24) ELSE NULL END,
  printf('2026-%02d-%02dT%02d:%02d:%02d.%03dZ',(id%12)+1,(id%28)+1,id%24,(id*7)%60,(id*11)%60,id%999)
FROM notification;
