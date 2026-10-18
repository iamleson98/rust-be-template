#!/usr/bin/env python3
"""Generate seed SQL for the local D1 database (datxevui Cloudflare migration).

Produces /home/z/my-project/migrations/seed.sql — apply with:
  wrangler d1 execute DB --local --file migrations/seed.sql
Idempotent: fixed UUIDs + INSERT OR IGNORE.
"""
import uuid

def u(seed: str) -> str:
    """Deterministic UUID from a seed string."""
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"datxevui:{seed}"))

BRANDS = [
    ("phuong-trang", "Phương Trang", "Futa Bus Lines — lớn nhất Việt Nam", "19006067", 4.6, 40, 60000),
    ("thanh-buoi", "Thành Bưởi", "Giường nằm chất lượng cao", "19006070", 4.4, 40, 50000),
    ("hoang-long", "Hoàng Long", "Giá tốt, lịch chạy dày", "19006073", 4.1, 40, 40000),
]

ROUTES = [
    ("ha-noi-da-nang", "Hà Nội → Đà Nẵng", "ha-noi", "da-nang", "phuong-trang"),
    ("ha-noi-da-nang-tb", "Hà Nội → Đà Nẵng", "ha-noi", "da-nang", "thanh-buoi"),
    ("sgn-nhatrang", "TP. Hồ Chí Minh → Nha Trang", "ho-chi-minh", "khanh-hoa", "phuong-trang"),
    ("sgn-nhatrang-hl", "TP. Hồ Chí Minh → Nha Trang", "ho-chi-minh", "khanh-hoa", "hoang-long"),
    ("hcm-dalat", "TP. Hồ Chí Minh → Đà Lạt", "ho-chi-minh", "lam-dong", "thanh-buoi"),
    ("hanoi-sapa", "Hà Nội → Sa Pa", "ha-noi", "lao-cai", "phuong-trang"),
]

# (route, dep_time, base_adult, base_child, vehicle_code, layout, amenities)
SCHEDULES = [
    ("ha-noi-da-nang",     "08:00", 450000, 300000, "sleeper",      "sleeper-40", '["wifi","blanket","water","charging"]'),
    ("ha-noi-da-nang",     "20:00", 480000, 320000, "sleeper",      "sleeper-40", '["wifi","blanket","water","charging"]'),
    ("ha-noi-da-nang-tb",  "21:30", 420000, 280000, "sleeper",      "sleeper-40", '["wifi","water"]'),
    ("sgn-nhatrang",       "07:00", 320000, 220000, "sleeper",      "sleeper-40", '["wifi","blanket","water"]'),
    ("sgn-nhatrang-hl",    "19:00", 280000, 190000, "semi_sleeper", "sleeper-40", '["water"]'),
    ("hcm-dalat",          "08:30", 260000, 180000, "limousine",    "limo-11",    '["wifi","water","snack"]'),
    ("hanoi-sapa",         "22:00", 380000, 260000, "limousine",    "limo-11",    '["wifi","water","charging"]'),
]

# Popular places for FTS5 search (name, no-tones, type, province, district, lat, lon, pop)
PLACES = [
    ("Hà Nội", "ha noi", "city", "Hà Nội", None, 21.0285, 105.8542, 8053663),
    ("Thành phố Hồ Chí Minh", "thanh pho ho chi minh", "city", "TP. Hồ Chí Minh", None, 10.8231, 106.6297, 9000000),
    ("Đà Nẵng", "da nang", "city", "Đà Nẵng", None, 16.0544, 108.2022, 1153831),
    ("Nha Trang", "nha trang", "city", "Khánh Hòa", None, 12.2388, 109.1967, 421544),
    ("Đà Lạt", "da lat", "city", "Lâm Đồng", None, 11.9404, 108.4583, 406924),
    ("Sa Pa", "sa pa", "town", "Lào Cai", None, 22.3368, 103.8439, 82000),
    ("Hội An", "hoi an", "town", "Quảng Nam", None, 15.8801, 108.3380, 122000),
    ("Huế", "hue", "city", "Thừa Thiên Huế", None, 16.4637, 107.5909, 490000),
    ("Vũng Tàu", "vung tau", "city", "Bà Rịa - Vũng Tàu", None, 10.3460, 107.0842, 527000),
    ("Cần Thơ", "can tho", "city", "Cần Thơ", None, 10.0452, 105.7469, 1237000),
    ("Bến xe Miền Đông", "ben xe mien dong", "poi", "TP. Hồ Chí Minh", "Bình Thạnh", 10.8053, 106.7130, 0),
    ("Bến xe Giáp Bát", "ben xe giap bat", "poi", "Hà Nội", "Hoàng Mai", 20.9612, 105.8437, 0),
    ("Sân bay Nội Bài", "san bay noi bai", "poi", "Hà Nội", "Sóc Sơn", 21.2212, 105.8072, 0),
    ("Phố cổ Hà Nội", "pho co ha noi", "poi", "Hà Nội", "Hoàn Kiếm", 21.0308, 105.8526, 0),
    ("Bãi biển Mỹ Khê", "bai bien my khe", "poi", "Đà Nẵng", "Sơn Trà", 16.0453, 108.2410, 0),
    ("Quận 1", "quan 1", "district", "TP. Hồ Chí Minh", "Quận 1", 10.7764, 106.7012, 0),
    ("Quận Hoàn Kiếm", "quan hoan kiem", "district", "Hà Nội", "Hoàn Kiếm", 21.0289, 105.8527, 0),
    ("Phường Bến Nghé", "phuong ben nghe", "ward", "TP. Hồ Chí Minh", "Quận 1", 10.7830, 106.7040, 0),
    ("Thành phố Huế (trung tâm)", "thanh pho hue trung tam", "suburb", "Thừa Thiên Huế", "TP. Huế", 16.4600, 107.5900, 0),
    ("Vinh", "vinh", "city", "Nghệ An", None, 18.6796, 105.6813, 490000),
    ("Đồng Hới", "dong hoi", "city", "Quảng Bình", None, 17.4833, 106.6000, 116000),
    (" Quy Nhơn", "quy nhon", "city", "Bình Định", None, 13.7826, 109.2197, 280000),
    ("Cà Mau", "ca mau", "city", "Cà Mau", None, 9.1769, 105.1502, 204000),
    ("Thành phố Thái Nguyên", "thanh pho thai nguyen", "city", "Thái Nguyên", None, 21.5942, 105.8481, 330000),
]

def sleeper_40():
    """40-seat sleeper: rows A1..A10, B1..B10 (floor 1); C1..C10, D1..D10 (floor 2)."""
    seats = []
    n = 0
    for floor, prefix in ((1, "A"), (1, "B"), (2, "C"), (2, "D")):
        for row in range(1, 11):
            n += 1
            label = f"{prefix}{row}"
            seat_class = "vip" if row in (1, 2) else "standard"
            is_window = prefix in ("A", "D")
            seats.append((label, seat_class, row, 1 if prefix in ("A", "C") else 2, is_window, floor))
    return seats

def limo_11():
    """11-seat limousine: row 1 = A1,A2; rows 2-4 = 3 seats; row 5 = A11."""
    seats = []
    layout = [("A1", 1, 1, False), ("A2", 1, 2, True)]
    for row in range(2, 5):
        for col, w in ((1, False), (2, False), (3, True)):
            layout.append((f"{'B' if row == 2 else 'C' if row == 3 else 'D'}{col if row == 2 else col}", row, col, w))
    # simplify: B1..B3, C1..C3, D1..D2
    layout = [("A1", 1, 1, False), ("A2", 1, 2, True)]
    for col in (1, 2, 3):
        layout.append((f"B{col}", 2, col, col == 3))
    for col in (1, 2, 3):
        layout.append((f"C{col}", 3, col, col == 3))
    for col in (1, 2):
        layout.append((f"D{col}", 4, col, col == 2))
    layout.append(("E1", 5, 1, False))
    for label, row, col, w in layout:
        seat_class = "vip" if row == 1 else "standard"
        seats.append((label, seat_class, row, col, w, 1))
    return seats

# Map vt codes to the migration-seeded fixed ids (00000000-0000-4000-c000-...).
VT_IDS = {
    "limousine": "00000000-0000-4000-c000-000000000001",
    "minivan": "00000000-0000-4000-c000-000000000002",
    "standard": "00000000-0000-4000-c000-000000000003",
    "semi_sleeper": "00000000-0000-4000-c000-000000000004",
    "sleeper": "00000000-0000-4000-c000-000000000005",
}

def main():
    out = ["-- Seed data for local dev (idempotent, fixed UUID5 ids)", "BEGIN TRANSACTION;"]
    B = {}
    for slug, name, desc, phone, rating, max_age, disc in BRANDS:
        B[slug] = u(f"brand:{slug}")
        out.append(
            f"INSERT OR IGNORE INTO brand (id, slug, name, description, contact_phone, rating, status, total_trips, child_max_age, child_discount_amount, created_at, updated_at) VALUES "
            f"('{B[slug]}', '{slug}', '{name}', '{desc}', '{phone}', {rating}, 'active', 0, {max_age}, {disc}, datetime('now'), datetime('now'));"
        )
    # layouts + seats
    for code, seats, label in (("sleeper-40", sleeper_40(), "Sleeper 40 chỗ"), ("limo-11", limo_11(), "Limousine 11 chỗ")):
        lid = u(f"layout:{code}")
        total = len(seats)
        vt = {"sleeper-40": "sleeper", "limo-11": "limousine"}[code]
        out.append(
            f"INSERT OR IGNORE INTO bus_layout (id, brand_id, name, vehicle_type, total_seats, layout_data, created_at, updated_at) VALUES "
            f"('{lid}', NULL, '{label}', '{vt}', {total}, NULL, datetime('now'), datetime('now'));"
        )
        for label_s, seat_class, row, col, w, floor in seats:
            sid = u(f"seat:{code}:{label_s}")
            out.append(
                f"INSERT OR IGNORE INTO seat (id, bus_layout_id, seat_label, seat_class, row_num, col_num, is_window, floor, created_at) VALUES "
                f"('{sid}', '{lid}', '{label_s}', '{seat_class}', {row}, {col}, {int(w)}, {floor}, datetime('now'));"
            )
    # routes + schedules (+ fares)
    for slug, name, start, end, brand in ROUTES:
        rid = u(f"route:{slug}")
        out.append(
            f"INSERT OR IGNORE INTO route (id, brand_id, name, start_location_id, end_location_id, status, created_at, updated_at) VALUES "
            f"('{rid}', '{B[brand]}', '{name}', '{start}', '{end}', 'active', datetime('now'), datetime('now'));"
        )
    for rslug, dep, adult, child, vt_code, layout_code, amenities in SCHEDULES:
        sid = u(f"schedule:{rslug}:{dep}")
        rid = u(f"route:{rslug}")
        layout_id = u(f"layout:{layout_code}")
        vt_id = VT_IDS[vt_code]
        out.append(
            f"INSERT OR IGNORE INTO schedule (id, route_id, departure_time, effective_from, effective_to, days_of_week, bus_layout_id, base_price_adult, base_price_child, amenities, vehicle_type_id, created_at) VALUES "
            f"('{sid}', '{rid}', '{dep}', date('now','-30 days'), date('now','+180 days'), '[]', '{layout_id}', {adult}, {child}, '{amenities}', '{vt_id}', datetime('now'));"
        )
        for seat_class, mult in (("vip", 1.25), ("standard", 1.0)):
            out.append(
                f"INSERT OR IGNORE INTO schedule_fare (id, schedule_id, seat_class, price_adult, price_child, created_at, updated_at) VALUES "
                f"('{u(f'fare:{rslug}:{dep}:{seat_class}')}', '{sid}', '{seat_class}', {int(adult * mult)}, {int(child * mult)}, datetime('now'), datetime('now'));"
            )
    # places
    for name, no_tones, typ, province, district, lat, lon, pop in PLACES:
        pid = u(f"place:{no_tones}")
        out.append(
            f"INSERT OR IGNORE INTO place (id, osm_id, name, name_ascii, name_no_tones, type, province, district, ward, lat, lon, population, created_at) VALUES "
            f"('{pid}', NULL, '{name.strip()}', '{no_tones}', '{no_tones}', '{typ}', '{province}', {f'NULL' if not district else f"'{district}'"}, NULL, {lat}, {lon}, {pop}, datetime('now'));"
        )
    out.append("COMMIT;")
    with open("/home/z/my-project/migrations/seed.sql", "w") as f:
        f.write("\n".join(out) + "\n")
    print(f"seed.sql written: {len(out)} statements")

if __name__ == "__main__":
    main()
