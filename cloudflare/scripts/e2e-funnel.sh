#!/bin/bash
# E2E walk of the redesigned search→booking funnel against the live stack.
# Everything runs in ONE bash call (background procs die between calls).
# All clicks go through page-context eval with precise button matching —
# `find text` can hit aria-label/title shadows of non-interactive elements.
set -u
cd /home/z/rust-be-template

SHOTS=/home/z/my-project/download/e2e-shots
mkdir -p "$SHOTS"

echo "── start backend ──"
DATABASE_URL="sqlite:///tmp/vexevn/app.db?mode=rwc" ./target/debug/backend > /tmp/backend.log 2>&1 &
BACKEND_PID=$!
sleep 7
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
curl -s -A "$UA" http://localhost:8080/api/stats > /dev/null && echo "backend up" || { echo "BACKEND FAILED"; exit 1; }

AB="agent-browser"
$AB set viewport 1440 900 > /dev/null
$AB set headers "{\"User-Agent\":\"$UA\"}" > /dev/null

body() { $AB eval "document.body.innerText" 2>/dev/null; }
url() { $AB get url 2>/dev/null; }
shot() { $AB screenshot "$SHOTS/$1" > /dev/null; }
clickbtn() { # exact-ish button text
  $AB eval "(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim().includes('$1')); if(b){b.click(); return 'clicked'} return 'notfound'})()"
}

echo "══ 0. LOGIN as customer (booking hold requires auth) ══"
$AB cookies clear > /dev/null 2>&1
$AB open http://localhost:8080/login > /dev/null
sleep 5
do_login() {
  $AB find placeholder "email@example.com" fill "e2e-user@datxevui.test" > /dev/null 2>&1
  $AB find placeholder "••••••••" fill "Passw0rd!123" > /dev/null 2>&1
  sleep 0.5
  $AB eval "(()=>{const b=document.querySelector('button[type=submit]'); if(b){b.click(); return 'clicked'} return 'notfound'})()"
}
do_login
sleep 4
STATUS=$($AB eval "fetch('/api/auth/me').then(r=>r.status).then(String)" 2>/dev/null | tr -d '"')
if [ "$STATUS" != "200" ]; then
  echo "(login retry — first attempt status: $STATUS)"
  do_login
  sleep 4
fi
STATUS=$($AB eval "fetch('/api/auth/me').then(r=>r.status).then(String)" 2>/dev/null | tr -d '"')
[ "$STATUS" = "200" ] && echo "✓ logged in" || echo "✗ login failed (status $STATUS)"
shot 00-login.png
$AB open http://localhost:8080/ > /dev/null
sleep 3

echo "══ 1. HOME ══"
sleep 2
shot 01-home.png
body | grep -q "Tìm chuyến xe" && echo "✓ search CTA present" || echo "✗ SEARCH CTA MISSING"

echo "══ 2. SEARCH ══"
clickbtn "Tìm chuyến xe"
$AB wait --url "/search" --timeout 15000 > /dev/null 2>&1
sleep 4
echo "url: $(url)"
shot 02-search-results.png
R=$(body)
echo "$R" | grep -q "Phương Trang E2E" && echo "✓ seeded brand found" || echo "✗ no seeded brand"
echo "$R" | grep -q "402.500" && echo "✗ FABRICATED STRIKETHROUGH PRESENT" || echo "✓ no fabricated strikethrough price"
echo "$R" | grep -q "Giá tăng\|Giá giảm\|Giá ổn định" && echo "✗ FAKE TREND PRESENT" || echo "✓ no fake trend indicator"
echo "$R" | grep -q "Xem giờ đến" && echo "✓ honest arrival hint present" || echo "✗ arrival hint missing"
echo "$R" | grep -q "Bán nhanh" && echo "✗ selling-fast shown w/ 40 seats" || echo "✓ selling-fast only when real"
echo "$R" | grep -q "350.000" && echo "✓ real price rendered" || echo "✗ price missing"
echo "$R" | grep -q "Chọn chuyến" && echo "✓ trip card CTA present" || echo "✗ trip card CTA missing"

echo "══ 3. TRIP DETAIL ══"
clickbtn "Chọn chuyến"
$AB wait --url "/trips/" --timeout 15000 > /dev/null 2>&1
echo "url: $(url)"
$AB wait --text "A01" --timeout 25000 > /dev/null 2>&1 || echo "(A01 wait timed out)"
sleep 2
shot 03-trip-detail.png
D=$(body)
echo "$D" | grep -q "Giá gốc" && echo "✓ seat legend base price present" || echo "✗ legend base price missing"
echo "$D" | grep -qi "tầng dưới" && echo "✓ two decks render" || echo "✗ deck headers missing"

echo "══ 4. SELECT SEAT ══"
clickbtn "A01"
sleep 1.5
shot 04-seat-selected.png
S=$(body)
echo "$S" | grep -q "1/1" && echo "✓ seat selected (1/1)" || echo "✗ seat not counted"

echo "══ 5. PROCEED TO BOOKING ══"
$AB eval "(()=>{const dlg=document.querySelector('[role=dialog]'); const root=dlg||document; const b=[...root.querySelectorAll('button')].find(b=>b.textContent.trim()==='Đặt vé'&&!b.disabled); if(b){b.click(); return 'clicked'} const all=[...root.querySelectorAll('button')].filter(b=>b.textContent.includes('Đặt vé')).map(b=>({t:b.textContent.trim(),d:b.disabled})); return 'notfound '+JSON.stringify(all)})()"
sleep 3
B=$(body)
echo "$B" | grep -q "Thông tin liên hệ\|Hành khách" && echo "✓ booking dialog open" || echo "✗ booking dialog missing"
shot 05-booking-passenger.png

echo "══ 6. PASSENGER STEP ══"
$AB eval "(()=>{const i=[...document.querySelectorAll('input')].find(i=>(i.placeholder||'').includes('CCCD')); if(!i) return 'noinput'; const s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set; s.call(i,'Nguyễn Văn E2E'); i.dispatchEvent(new Event('input',{bubbles:true})); return 'ok'})()"
sleep 1
clickbtn "Tiếp tục"
sleep 2.5
C=$(body)
echo "$C" | grep -q "Thông tin liên hệ" && echo "✓ contact step reached" || echo "✗ contact step missing"
shot 06-booking-contact.png

echo "══ 7. CONTACT STEP ══"
$AB eval "(()=>{const i=[...document.querySelectorAll('input')].find(i=>(i.placeholder||'')==='Nguyễn Văn A'); if(!i) return 'noinput-name'; const s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set; s.call(i,'Nguyễn Văn E2E'); i.dispatchEvent(new Event('input',{bubbles:true})); return 'ok'})()"
$AB eval "(()=>{const i=[...document.querySelectorAll('input')].find(i=>(i.placeholder||'').includes('09xx')); if(!i) return 'noinput-phone'; const s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set; s.call(i,'0901234567'); i.dispatchEvent(new Event('input',{bubbles:true})); return 'ok'})()"
sleep 1
shot 06b-contact-filled.png
clickbtn "Tiếp tục"
sleep 2.5
P=$(body)
echo "$P" | grep -q "Ví MoMo" && echo "✓ payment step reached" || echo "✗ payment step missing"
echo "$P" | grep -q "Thanh toán tại xe" && echo "✓ payment options render" || echo "✗ payment options missing"
shot 07-payment.png

echo "══ 8. PAY ══"
clickbtn "Thanh toán tại xe"
sleep 1
shot 07b-payment-cod.png
$AB eval "(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim().startsWith('Thanh toán')&&!b.textContent.includes('tại xe')&&/350/.test(b.textContent)&&!b.disabled); if(b){b.click(); return 'clicked'} return 'notfound'})()"
sleep 6
S2=$(body)
echo "$S2" | grep -q "Đặt vé thành công" && echo "✓ BOOKING SUCCESS" || echo "✗ booking not successful"
echo "$S2" | grep -q "Vé điện tử" && echo "✓ ticket stub rendered" || echo "✗ ticket stub missing"
echo "$S2" | grep -q "Mã QR lên xe" && echo "✓ honest QR note present" || echo "✗ QR note missing"
shot 08-success.png

echo "══ ERRORS ══"
$AB errors 2>/dev/null | grep -v ServiceWorker | head -6
kill $BACKEND_PID 2>/dev/null
echo "=== E2E DONE ==="
