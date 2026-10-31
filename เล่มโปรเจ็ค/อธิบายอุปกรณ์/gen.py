# สร้าง index.html (เอกสารอธิบายการทำงานของอุปกรณ์) แล้วพิมพ์เป็น PDF ด้วย Edge headless
# รัน: python gen.py
import html, os, subprocess

IMG = '../รูปบทที่3/'
G, O, B, P = '#15803d', '#c2410c', '#1d4ed8', '#6b7280'   # ข้อมูลเข้า, คำสั่งออก, ส่วนประกอบ, ไฟเลี้ยง

def esc(s): return html.escape(s, quote=True)

def text_lines(x, y, lines, anchor, color, size=14, gap=17, bold_first=True):
    out = []
    for i, ln in enumerate(lines):
        w = '700' if (i == 0 and bold_first) else '400'
        fill = color if i == 0 else '#1f2937'
        out.append(f'<text x="{x}" y="{y + i*gap}" text-anchor="{anchor}" font-size="{size}" '
                   f'font-weight="{w}" fill="{fill}" class="halo">{esc(ln)}</text>')
    return ''.join(out)

def fig(img, iw_px, ih_px, box, callouts=(), tags=(), cw=640, ch=420, cls='fig', crop=None, tsize=12.5):
    ix, iy, w = box
    cx, cy, cwp, chp = crop or (0, 0, iw_px, ih_px)
    s = w / cwp
    h = chp * s
    P2 = lambda p: (ix + (p[0]-cx)*s, iy + (p[1]-cy)*s)
    out = [f'<svg class="{cls}" viewBox="0 0 {cw} {ch}" xmlns="http://www.w3.org/2000/svg">',
           f'<svg x="{ix}" y="{iy}" width="{w}" height="{h:.1f}" viewBox="{cx} {cy} {cwp} {chp}" preserveAspectRatio="none">'
           f'<image href="{IMG}{img}" x="0" y="0" width="{iw_px}" height="{ih_px}"/></svg>']
    for c in callouts:
        pts = c['p'] if isinstance(c['p'], list) else [c['p']]
        lx, ly = c['l']
        a = c.get('a', 'start')
        col = c.get('c', B)
        for p in pts:
            x, y = P2(p)
            out.append(f'<line x1="{x:.1f}" y1="{y:.1f}" x2="{lx}" y2="{ly}" stroke="#fff" stroke-width="5"/>'
                       f'<line x1="{x:.1f}" y1="{y:.1f}" x2="{lx}" y2="{ly}" stroke="{col}" stroke-width="2"/>'
                       f'<circle cx="{x:.1f}" cy="{y:.1f}" r="9" fill="none" stroke="#fff" stroke-width="5"/>'
                       f'<circle cx="{x:.1f}" cy="{y:.1f}" r="9" fill="none" stroke="{col}" stroke-width="2.5"/>'
                       f'<circle cx="{x:.1f}" cy="{y:.1f}" r="3.5" fill="{col}"/>')
        out.append(f'<circle cx="{lx}" cy="{ly}" r="3.5" fill="{col}"/>')
        tx = lx + (7 if a == 'start' else -7 if a == 'end' else 0)
        ty = ly + (7 if a != 'middle' else c.get('dy', 24))
        out.append(text_lines(tx, ty, c['t'].split('\n'), a, col, c.get('size', 20), gap=c.get('gap', 24)))
    for t in tags:
        x, y = P2(t['p'])
        ty = y + t['dy']
        col = t['c']
        out.append(f'<line x1="{x:.1f}" y1="{y:.1f}" x2="{x:.1f}" y2="{ty:.1f}" stroke="{col}" stroke-width="1.5"/>'
                   f'<circle cx="{x:.1f}" cy="{y:.1f}" r="5" fill="{col}" stroke="#fff" stroke-width="1.5"/>'
                   f'<text x="{x:.1f}" y="{ty + (4 if t["dy"] < 0 else tsize):.1f}" text-anchor="middle" font-size="{tsize}" '
                   f'font-weight="700" fill="{col}" class="halo">{esc(t["t"])}</text>')
    out.append('</svg>')
    return ''.join(out)

ROLE = {
    'send': ('ตัวส่ง', 'role-send'),
    'recv': ('ตัวรับ', 'role-recv'),
    'both': ('ตัวรับ + ตัวส่ง', 'role-both'),
    'power': ('จ่ายไฟ (ไม่ส่งข้อมูล)', 'role-power'),
}

def card(title, role, figsvg, rows, sub=''):
    lab, cls = ROLE[role]
    trs = ''.join(f'<tr><th>{esc(k)}</th><td>{v}</td></tr>' for k, v in rows)
    return (f'<div class="card"><div class="card-head"><h3>{esc(title)}</h3>'
            f'<span class="role {cls}">{lab}</span></div>'
            f'{"<div class=sub>"+esc(sub)+"</div>" if sub else ""}'
            f'{figsvg}<table class="kv">{trs}</table></div>')

def arrow(s): return f'<b class="arr">{s}</b>'

# ---------------------------------------------------------------- ภาพรวม
def node(x, y, w, h, img, title, subs, iw=None, ih=None, color='#1f2937'):
    iw = iw or 92; ih = ih or (h - 12)
    t = [f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="12" fill="#fff" stroke="#cbd5d0" stroke-width="1.5"/>',
         f'<image href="{IMG}{img}" x="{x+6}" y="{y+6}" width="{iw}" height="{ih}" preserveAspectRatio="xMidYMid meet"/>']
    tx = x + iw + 14
    t.append(f'<text x="{tx}" y="{y+28}" font-size="16" font-weight="700" fill="{color}">{esc(title)}</text>')
    for i, s in enumerate(subs):
        t.append(f'<text x="{tx}" y="{y+50+i*18}" font-size="13" fill="#374151">{esc(s)}</text>')
    return ''.join(t)

def vnode(x, y, w, h, img, ih, title, subs, color='#1f2937'):
    """รูปอยู่บน ข้อความอยู่ล่าง (กล่องใหญ่)"""
    t = [f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="12" fill="#fff" stroke="#cbd5d0" stroke-width="1.5"/>',
         f'<image href="{IMG}{img}" x="{x+8}" y="{y+8}" width="{w-16}" height="{ih}" preserveAspectRatio="xMidYMid meet"/>']
    cx = x + w/2
    t.append(f'<text x="{cx}" y="{y+ih+32}" text-anchor="middle" font-size="16" font-weight="700" fill="{color}">{esc(title)}</text>')
    for i, s in enumerate(subs):
        t.append(f'<text x="{cx}" y="{y+ih+52+i*18}" text-anchor="middle" font-size="13" fill="#374151">{esc(s)}</text>')
    return ''.join(t)

def line(x1, y1, x2, y2, col, label=None, lx=None, ly=None, anchor='middle', dash=False, both=False):
    m = {G: 'g', O: 'o', P: 'p', B: 'b'}[col]
    d = ' stroke-dasharray="7 6"' if dash else ''
    st = f' marker-start="url(#s{m})"' if both else ''
    s = f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{col}" stroke-width="3"{d} marker-end="url(#a{m})"{st}/>'
    if label:
        lx = (x1+x2)/2 if lx is None else lx
        ly = (y1+y2)/2 - 7 if ly is None else ly
        for i, ln in enumerate(label.split('\n')):
            s += (f'<text x="{lx}" y="{ly+i*16}" text-anchor="{anchor}" font-size="13" font-weight="600" '
                  f'fill="{col}" class="halo">{esc(ln)}</text>')
    return s

def overview():
    defs = ''.join(
        f'<marker id="a{k}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">'
        f'<path d="M0,0 L10,5 L0,10 z" fill="{c}"/></marker>'
        f'<marker id="s{k}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">'
        f'<path d="M0,0 L10,5 L0,10 z" fill="{c}"/></marker>'
        for k, c in (('g', G), ('o', O), ('p', P), ('b', B)))
    s = [f'<svg class="overview" viewBox="0 0 1200 650" xmlns="http://www.w3.org/2000/svg"><defs>{defs}</defs>']
    sensors = [
        ('dev_dht.jpg', 'DHT11', ['อุณหภูมิ + ความชื้น'], 'GPIO4'),
        ('dev_bh.jpg', 'BH1750', ['ความเข้มแสง (lux)'], 'I2C'),
        ('dev_ina.jpg', 'INA219', ['แรงดัน / กระแส / กำลังไฟ'], 'I2C'),
        ('dev_ph.jpg', 'เซ็นเซอร์ pH × 2', ['ค่า pH น้ำลัง1 / ลัง2'], 'ADC'),
        ('dev_sr04.jpg', 'JSN-SR04T × 4', ['ระดับน้ำในขวด 4 ใบ (mm)'], 'Trig/Echo'),
        ('dev_float.png', 'ลูกลอย × 2', ['ลังปลูกน้ำเต็มหรือยัง'], '19 / 13'),
    ]
    for i, (img, t, subs, lab) in enumerate(sensors):
        y = 10 + i*108
        s.append(node(10, y, 255, 92, img, t, subs, iw=86))
        ty = 228 + i*34
        yc = y + 46
        mk = ' marker-start="url(#sg)"' if i == 4 else ''
        s.append(f'<path d="M267,{yc} L325,{yc} L386,{ty}" fill="none" stroke="{G}" stroke-width="3" marker-end="url(#ag)"{mk}/>'
                 f'<text x="272" y="{yc-8}" font-size="13" font-weight="600" fill="{G}" class="halo">{esc(lab)}</text>')
    # ESP32
    s.append(vnode(390, 170, 250, 280, 'dev_esp.jpg', 185, 'ESP32', ['ศูนย์กลางที่หน้างาน', 'อ่านเซ็นเซอร์ + สั่งรีเลย์']))
    # Server
    s.append(vnode(780, 150, 200, 200, 'web_render.png', 110, 'เซิร์ฟเวอร์ Node.js', ['(Render) — Auto Mode ตัดสินใจ']))
    s.append(line(642, 215, 776, 215, G, 'POST /api/data\nทุก 2 วินาที', ly=180))
    s.append(line(778, 285, 644, 285, O, 'ตอบกลับ relayStates\n(สั่งเปิด/ปิดรีเลย์)', ly=305))
    # Supabase
    s.append(vnode(1035, 150, 155, 200, 'web_supabase.png', 110, 'Supabase', ['ฐานข้อมูลบนคลาวด์']))
    s.append(line(984, 250, 1031, 250, B, 'บันทึก', ly=238, both=True))
    s.append(f'<text x="1007" y="272" text-anchor="middle" font-size="13" font-weight="600" fill="{B}" class="halo">โหลด</text>')
    # Browser
    s.append(vnode(780, 400, 200, 120, 'web_overview_live.png', 50, 'เว็บเบราว์เซอร์', ['หน้าแดชบอร์ด']))
    s.append(line(850, 354, 850, 396, G, 'Socket.io\nค่า real-time', lx=842, ly=372, anchor='end'))
    s.append(line(910, 396, 910, 354, O, 'กดสั่งรีเลย์\n/ ตั้งค่า', lx=924, ly=372, anchor='start'))
    # Relay + pump + power
    s.append(node(390, 500, 250, 120, 'dev_relay.jpg', 'รีเลย์ 8 ช่อง', ['ตัด / ต่อไฟให้ปั๊ม', 'Active LOW'], iw=120))
    s.append(line(515, 454, 515, 496, O, 'GPIO × 8', lx=523, ly=480, anchor='start'))
    s.append(node(700, 540, 250, 100, 'dev_pump.jpg', 'ปั๊มน้ำ × 8', ['สูบน้ำตามคำสั่ง', 'DC 5V'], iw=86))
    s.append(line(642, 590, 696, 590, O, 'ไฟ 5V', ly=578))
    s.append(node(985, 540, 205, 100, 'dev_lm2596.jpg', 'LM2596', ['แบต 12V → 5V', 'จ่ายไฟทั้งระบบ'], iw=86))
    s.append(line(983, 610, 954, 610, P, None, dash=True))
    s.append(f'<text x="1087" y="534" text-anchor="middle" font-size="12" fill="{P}">จ่าย 5V: ESP32 · เซ็นเซอร์ · รีเลย์ · ปั๊ม</text>')
    s.append('</svg>')
    return ''.join(s)

# ---------------------------------------------------------------- ESP32
TOPX = dict(D23=213, D22=260, D21=405, D19=455, D18=500, D5=550, TX2=598, RX2=645, D4=693, D2=740, D15=788)
BOTX = dict(VN=310, D34=357, D35=405, D32=455, D25=550, D26=598, D27=645, D14=693, D13=788, VIN=880)

def esp_fig():
    tags = []
    top = [('D23', 'R4', O), ('D22', 'SCL', G), ('D21', 'SDA', G), ('D19', 'ลอย1', G), ('D18', 'R3', O),
           ('D5', 'R2', O), ('TX2', 'R8', O), ('RX2', 'R7', O), ('D4', 'DHT', G), ('D2', 'R1', O), ('D15', 'R5', O)]
    for i, (pin, t, c) in enumerate(top):
        tags.append(dict(p=(TOPX[pin], 103), dy=-32 if i % 2 == 0 else -56, t=t, c=c))
    bot = [('VN', 'pH2', G), ('D34', 'pH1', G), ('D35', 'Echo', G), ('D32', 'Echo', G), ('D25', 'Trig', O),
           ('D26', 'Echo', G), ('D27', 'Echo', G), ('D14', 'R6', O), ('D13', 'ลอย2', G), ('VIN', '5V', P)]
    for i, (pin, t, c) in enumerate(bot):
        tags.append(dict(p=(BOTX[pin], 572), dy=26 if i % 2 == 0 else 50, t=t, c=c))
    callouts = [
        dict(p=(400, 300), l=(125, 200), a='end', t='ชิป ESP32\n+ WiFi\nส่ง/รับข้อมูล\nกับเซิร์ฟเวอร์', size=19),
        dict(p=(990, 205), l=(740, 160), t='ปุ่ม BOOT', size=19),
        dict(p=(1010, 330), l=(740, 250), t='พอร์ต USB\nอัปโหลด\nโปรแกรม', size=19),
        dict(p=(1000, 487), l=(740, 380), t='ปุ่ม EN\n(รีเซ็ต) กด\nหลังจ่ายไฟ', size=19),
    ]
    return fig('dev_esp.jpg', 1100, 845, (135, 75, 590), callouts, tags, cw=880, ch=570, cls='fig fig-esp', tsize=16)

ESP_PINS = [
    ('GPIO4 (D4)', 'DHT11 ขา out', 'เข้า', 'อุณหภูมิ / ความชื้น'),
    ('GPIO21 SDA · GPIO22 SCL', 'BH1750 + INA219 (บัส I2C ร่วม)', 'เข้า', 'แสง, แรงดัน, กระแส'),
    ('GPIO34 (D34)', 'โมดูล pH ลัง1 ขา Po', 'เข้า', 'แรงดันแอนะล็อก → pH'),
    ('GPIO39 (ขา VN)', 'โมดูล pH ลัง2 ขา Po', 'เข้า', 'แรงดันแอนะล็อก → pH'),
    ('GPIO25 (D25)', 'Trig ของ JSN-SR04T ทั้ง 4 ตัว', 'ออก', 'สั่งยิงคลื่นเสียง'),
    ('GPIO26 / 27 / 32 / 35', 'Echo: ถังรองรับน้ำลัง2 / ถังสาร pH Down / ถังน้ำเปล่า / ถังรองรับน้ำลัง1', 'เข้า', 'เวลาคลื่นสะท้อน → mm'),
    ('GPIO19 · GPIO13', 'ลูกลอยลัง1 · ลังปลูก2', 'เข้า', 'เต็ม / ยังไม่เต็ม'),
    ('GPIO2, 5, 18, 23, 15, 14, 16, 17', 'รีเลย์ IN1 – IN8 (R1 – R8)', 'ออก', 'LOW = ปั๊มติด'),
    ('VIN · GND', 'LM2596 5V', 'ไฟเข้า', 'ไฟเลี้ยงบอร์ด'),
]

def esp_table():
    rows = ''.join(
        f'<tr><td class="mono">{esc(a)}</td><td>{esc(b)}</td>'
        f'<td><span class="dir {"d-in" if c=="เข้า" else "d-out" if c=="ออก" else "d-pw"}">{esc(c)}</span></td><td>{esc(d)}</td></tr>'
        for a, b, c, d in ESP_PINS)
    return f'<table class="grid"><thead><tr><th>ขา ESP32</th><th>ต่อกับ</th><th>ทิศ</th><th>สัญญาณ</th></tr></thead><tbody>{rows}</tbody></table>'

# ---------------------------------------------------------------- อุปกรณ์อื่น
def dht():
    return fig('dev_dht.jpg', 723, 1100, (190, 10, 290), [
        dict(p=(310, 330), l=(170, 90), a='end', t='ตัววัด\nอุณหภูมิ +\nความชื้น'),
        dict(p=(255, 980), l=(170, 380), a='end', t='+ : ไฟเลี้ยง', c=P),
        dict(p=(322, 960), l=(500, 300), t='out :\nส่งข้อมูล\n→ ESP32\nGPIO4', c=G),
        dict(p=(392, 980), l=(500, 435), t='− : GND', c=P),
    ], ch=465)

def bh():
    return fig('dev_bh.jpg', 1100, 1100, (120, 0, 400), [
        dict(p=(712, 555), l=(525, 70), t='ชิปวัดแสง\nBH1750'),
        dict(p=(365, 650), l=(110, 200), a='end', t='VCC/GND\nไฟเลี้ยง', c=P),
        dict(p=[(460, 745), (522, 790)], l=(190, 440), t='SCL → GPIO22 · SDA → GPIO21\n(I2C ส่งค่า lux ให้ ESP32)', c=G),
    ], ch=500)

def ina():
    return fig('dev_ina.jpg', 1100, 734, (120, 80, 400), [
        dict(p=[(330, 355), (410, 355)], l=(320, 40), a='middle', dy=-8, t='Vin+ / Vin− ต่ออนุกรมสายที่จะวัด', c=P),
        dict(p=(370, 422), l=(535, 150), t='ชันท์\nวัดกระแส'),
        dict(p=(360, 495), l=(105, 200), a='end', t='ชิป\nINA219'),
        dict(p=[(222, 588), (270, 588)], l=(105, 320), a='end', t='Vcc/Gnd\nไฟเลี้ยง', c=P),
        dict(p=[(323, 588), (378, 588)], l=(170, 405), t='Scl → GPIO22 · Sda → GPIO21\n(I2C ส่งค่า V/A/W ให้ ESP32)', c=G),
    ], crop=(80, 290, 560, 380), ch=470)

def ph():
    return fig('dev_ph.jpg', 1100, 1100, (120, 70, 400), [
        dict(p=(190, 600), l=(105, 110), a='end', t='ขา Po :\nแรงดันออก\n→ GPIO\n34 / 39', c=G),
        dict(p=(330, 680), l=(320, 40), a='middle', dy=-8, t='วงจรขยายสัญญาณ'),
        dict(p=[(250, 760), (400, 810)], l=(150, 385), t='ปุ่มปรับค่า (calibrate)'),
        dict(p=(930, 830), l=(530, 250), t='ช่องเสียบ\nหัววัด pH\n(BNC)'),
    ], crop=(40, 430, 1020, 650), ch=420)

def sr04():
    return fig('dev_sr04.jpg', 1100, 578, (100, 60, 440), [
        dict(p=(785, 370), l=(550, 100), t='หัววัด\nกันน้ำ\n(ติดฝา\nขวด)'),
        dict(p=(500, 380), l=(85, 110), a='end', t='บอร์ด\nวงจร'),
        dict(p=(595, 475), l=(110, 380), t='5V · Trig ← GPIO25\nEcho → ESP32 · GND', c=G),
    ], crop=(370, 250, 510, 300), ch=440)

def flt():
    return fig('dev_float.png', 291, 254, (170, 10, 330), [
        dict(p=(75, 45), l=(155, 50), a='end', t='ลูกลอย\nขึ้น–ลง\nตามน้ำ'),
        dict(p=(230, 135), l=(515, 230), t='เกลียวยึด\nผนังลัง'),
        dict(p=(110, 200), l=(155, 280), a='end', t='สาย 2 เส้น\n→ GPIO19\n/ 13 + GND', c=G),
    ], ch=370)

def relay():
    return fig('dev_relay.jpg', 1100, 734, (125, 50, 410), [
        dict(p=(440, 425), l=(110, 220), a='end', t='IN1–IN8\n← ESP32\nLOW=ติด', c=O),
        dict(p=(500, 250), l=(320, 30), a='middle', dy=-8, t='รีเลย์ = สวิตช์ตัด/ต่อไฟ'),
        dict(p=(700, 215), l=(545, 120), t='COM/NO\n→ ปั๊ม', c=O),
        dict(p=(762, 625), l=(545, 300), t='VCC/GND\nไฟ 5V', c=P),
    ], ch=360)

def pump():
    return fig('dev_pump.jpg', 1100, 1100, (190, 10, 330), [
        dict(p=(80, 295), l=(175, 40), a='end', t='สายไฟ +/−\n← รีเลย์', c=O),
        dict(p=(470, 490), l=(175, 170), a='end', t='ทางน้ำออก'),
        dict(p=(430, 860), l=(175, 290), a='end', t='ทางดูด\nน้ำเข้า'),
        dict(p=(820, 520), l=(535, 230), t='มอเตอร์\nDC 5V'),
    ], ch=350)

def lm():
    return fig('dev_lm2596.jpg', 1100, 596, (110, 60, 420), [
        dict(p=(160, 485), l=(95, 250), a='end', t='IN\n12V', c=P),
        dict(p=(945, 470), l=(545, 250), t='OUT\n5V', c=P),
        dict(p=(615, 130), l=(330, 30), a='middle', dy=-8, t='ปรับแรงดันขาออก'),
        dict(p=(420, 260), l=(95, 130), a='end', t='ชิป\nLM2596'),
    ], ch=320)

def screen(img, iw, ih, callouts, ch=300):
    return fig(img, iw, ih, (20, 20, 600), callouts, ch=ch)

def browser():
    return fig('web_overview_live.png', 1568, 523, (10, 60, 620), [
        dict(p=(900, 260), l=(330, 30), a='middle', dy=-8, t='ค่าเซ็นเซอร์ real-time ← เซิร์ฟเวอร์', c=G),
        dict(p=(70, 283), l=(40, 300), t='เมนูควบคุม: กดสั่งงาน → เซิร์ฟเวอร์', c=O),
    ], ch=330)

RELAY_ROWS = [
    ('R1', '2', 'เติมลัง1', 'ถังน้ำเปล่า', 'ลังปลูกผัก1'),
    ('R2', '5', 'เติมลัง2', 'ถังน้ำเปล่า', 'ลังปลูกผัก2'),
    ('R3', '18', 'pH Down ลัง1', 'ถังสาร pH Down', 'ลังปลูกผัก1'),
    ('R4', '23', 'pH Down ลัง2', 'ถังสาร pH Down', 'ลังปลูกผัก2'),
    ('R5', '15', 'รองรับ1 → ลัง1', 'ถังรองรับน้ำลัง1', 'ลังปลูกผัก1'),
    ('R6', '14', 'ลัง1 → รองรับ1', 'ลังปลูกผัก1', 'ถังรองรับน้ำลัง1'),
    ('R7', '16', 'รองรับ2 → ลัง2', 'ถังรองรับน้ำลัง2', 'ลังปลูกผัก2'),
    ('R8', '17', 'ลัง2 → รองรับ2', 'ลังปลูกผัก2', 'ถังรองรับน้ำลัง2'),
]

SUMMARY = [
    ('DHT11', 'วัดอุณหภูมิ / ความชื้นอากาศ', 'send', 'ESP32', 'สายข้อมูลดิจิทัล GPIO4'),
    ('BH1750', 'วัดความเข้มแสง (lux)', 'send', 'ESP32', 'I2C (GPIO21/22)'),
    ('INA219', 'วัดแรงดัน / กระแส / กำลังไฟ', 'send', 'ESP32', 'I2C (GPIO21/22)'),
    ('เซ็นเซอร์ pH × 2', 'วัด pH น้ำลัง1 / ลัง2', 'send', 'ESP32', 'แอนะล็อก GPIO34 / 39'),
    ('JSN-SR04T × 4', 'วัดระดับน้ำในขวด 4 ใบ', 'both', 'ESP32', 'รับ Trig GPIO25, ส่ง Echo GPIO26/27/32/35'),
    ('ลูกลอย × 2', 'บอกว่าลังปลูกน้ำเต็มหรือยัง', 'send', 'ESP32', 'ดิจิทัล GPIO19 / 13'),
    ('ESP32', 'รวบรวมค่าเซ็นเซอร์ + สั่งรีเลย์', 'both', 'เซิร์ฟเวอร์ / รีเลย์', 'WiFi HTTPS ทุก 2 วินาที, GPIO × 8'),
    ('เซิร์ฟเวอร์ Node.js', 'Auto Mode ตัดสินใจเปิด/ปิดปั๊ม', 'both', 'ESP32 / เบราว์เซอร์ / Supabase', 'HTTPS, Socket.io'),
    ('Supabase', 'เก็บรอบปลูก การตั้งค่า ผู้ใช้', 'both', 'เซิร์ฟเวอร์', 'HTTPS (REST API)'),
    ('เว็บเบราว์เซอร์', 'แสดงผล + ผู้ดูแลกดสั่งงาน', 'both', 'เซิร์ฟเวอร์', 'Socket.io / HTTPS POST'),
    ('รีเลย์ 8 ช่อง', 'ตัด / ต่อไฟให้ปั๊ม', 'recv', 'ปั๊มน้ำ (ส่งไฟ)', 'รับ GPIO จาก ESP32'),
    ('ปั๊มน้ำ × 8', 'สูบน้ำระหว่างถังกับลัง', 'recv', '—', 'รับไฟ 5V ผ่านรีเลย์'),
    ('LM2596', 'ลดแรงดันแบต 12V → 5V', 'power', 'ทุกอุปกรณ์ (ไฟเลี้ยง)', 'สายไฟ'),
]

def page(inner, n, title):
    return (f'<section class="page"><header><h2>{esc(title)}</h2><span class="pno">{n}</span></header>'
            f'{inner}</section>')

LEGEND = (f'<div class="legend"><span><i style="background:{G}"></i>ข้อมูลเซ็นเซอร์ (ส่งเข้า)</span>'
          f'<span><i style="background:{O}"></i>คำสั่งควบคุม (ส่งออก)</span>'
          f'<span><i style="background:{B}"></i>ข้อมูลระหว่างเซิร์ฟเวอร์ – ฐานข้อมูล</span>'
          f'<span><i class="dash" style="border-color:{P}"></i>ไฟเลี้ยง</span></div>')

def build():
    pages = []
    p1 = ('<div class="cover"><h1>การทำงานของอุปกรณ์และเส้นทางการส่งข้อมูล</h1>'
          '<p>ระบบปลูกผักไฮโดรโปนิกส์อัตโนมัติ (Smart Farm) — เซ็นเซอร์ส่งค่าให้ ESP32 → ESP32 ส่งขึ้นเซิร์ฟเวอร์ '
          '→ เซิร์ฟเวอร์ตัดสินใจแล้วตอบคำสั่งกลับ → ESP32 สั่งรีเลย์เปิด/ปิดปั๊ม</p></div>'
          + LEGEND + overview())
    pages.append(page(p1, 1, 'ภาพรวมการไหลของข้อมูล'))

    p2 = (f'<div class="esp-wrap"><div class="esp-fig">{esp_fig()}'
          f'<div class="role-line"><span class="role role-both">ตัวรับ + ตัวส่ง</span> '
          f'ศูนย์กลางที่หน้างาน: <b>รับ</b> ค่าจากเซ็นเซอร์ทุกตัว → <b>ส่ง</b> JSON ไปเซิร์ฟเวอร์ '
          f'(HTTPS POST <span class="mono">/api/data</span> ทุก 2 วินาที) → <b>รับ</b> คำสั่ง relayStates ในคำตอบ '
          f'→ <b>ส่ง</b> สัญญาณไปรีเลย์ 8 ช่อง · ถ้าไม่ได้คำตอบเกิน 30 วินาที ปิดรีเลย์ทุกตัวเอง (failsafe)</div></div>'
          f'<div class="esp-side">{esp_table()}'
          f'<p class="note">ป้ายบนรูป: <b style="color:{G}">สีเขียว</b> = ขารับค่าเข้า · '
          f'<b style="color:{O}">สีส้ม</b> = ขาส่งสัญญาณออก · R1–R8 = รีเลย์ช่องที่ 1–8 · '
          f'ขา VN บนบอร์ด = GPIO39</p></div></div>')
    pages.append(page(p2, 2, 'ESP32 — ตัวกลางรับค่าเซ็นเซอร์และสั่งรีเลย์'))

    C = {}
    C['dht'] = card('DHT11', 'send', dht(), [
        ('หน้าที่', 'วัดอุณหภูมิ (°C) และความชื้นสัมพัทธ์ (%) ของอากาศรอบแปลง'),
        ('รับจาก', 'ไฟเลี้ยงจากบอร์ด (ไม่รับข้อมูล)'),
        ('ส่งไปที่', arrow('ESP32 GPIO4') + ' สัญญาณดิจิทัลสายเดียว'),
    ])
    C['bh'] = card('BH1750 (GY-302)', 'send', bh(), [
        ('หน้าที่', 'วัดความเข้มแสง หน่วย lux'),
        ('รับจาก', 'ESP32 ถามค่าผ่านบัส I2C'),
        ('ส่งไปที่', arrow('ESP32') + ' ทาง I2C: SDA GPIO21, SCL GPIO22'),
    ])
    C['ina'] = card('INA219', 'send', ina(), [
        ('หน้าที่', 'วัดแรงดัน (V) กระแส (A) และกำลังไฟ (W) ของระบบไฟ'),
        ('รับจาก', 'กระแสไฟที่ไหลผ่าน Vin+ → Vin−'),
        ('ส่งไปที่', arrow('ESP32') + ' ทาง I2C บัสเดียวกับ BH1750'),
    ])
    C['ph'] = card('เซ็นเซอร์ pH × 2', 'send', ph(), [
        ('หน้าที่', 'หัววัดจุ่มน้ำในลังปลูก → โมดูลแปลงเป็นแรงดัน 0–3 V ตามค่า pH'),
        ('รับจาก', 'หัววัด pH ผ่านช่อง BNC'),
        ('ส่งไปที่', arrow('ESP32') + ' ลัง1 → GPIO34, ลัง2 → GPIO39 (ขา VN) อ่านด้วย ADC'),
    ])
    C['sr'] = card('JSN-SR04T × 4', 'both', sr04(), [
        ('หน้าที่', 'วัดระยะผิวน้ำในขวด 4 ใบ แล้วคำนวณเป็นระดับน้ำ (mm)'),
        ('รับจาก', arrow('ESP32 GPIO25') + ' ส่งพัลส์ Trig (ใช้ร่วมทุกตัว)'),
        ('ส่งไปที่', arrow('ESP32') + ' พัลส์ Echo: ถังรองรับน้ำลัง2 → GPIO26, ถังสาร pH Down → GPIO27, '
                     'ถังน้ำเปล่า → GPIO32, ถังรองรับน้ำลัง1 → GPIO35'),
    ])
    C['flt'] = card('สวิตช์ลูกลอย × 2', 'send', flt(), [
        ('หน้าที่', 'ติดในลังปลูกที่ระดับน้ำเต็ม (ถึงราก) — น้ำดันลูกลอยขึ้น = เต็ม'),
        ('รับจาก', 'ระดับน้ำในลัง (กลไก ไม่ใช้ไฟ)'),
        ('ส่งไปที่', arrow('ESP32') + ' ลัง1 → GPIO19, ลัง2 → GPIO13 → เซิร์ฟเวอร์ใช้ตัดปั๊มเติมทันที'),
    ])
    C['relay'] = card('รีเลย์ 8 ช่อง', 'recv', relay(), [
        ('หน้าที่', 'สวิตช์ไฟฟ้าที่ ESP32 สั่งได้ ใช้ตัด/ต่อไฟเข้าปั๊ม (ขา ESP32 จ่ายกระแสปั๊มเองไม่ได้)'),
        ('รับจาก', arrow('ESP32') + ' GPIO 8 ขา — LOW = ติด, HIGH = ดับ'),
        ('ส่งไปที่', arrow('ปั๊มน้ำ') + ' ส่งไฟ 5V ผ่านหน้าสัมผัส COM → NO'),
    ])
    rr = ''.join(f'<tr><td class="mono">{a}</td><td class="mono">{b}</td><td>{esc(c)}</td>'
                 f'<td>{esc(d)}</td><td>→</td><td>{esc(e)}</td></tr>' for a, b, c, d, e in RELAY_ROWS)
    C['rtable'] = (f'<div class="card"><h3>รีเลย์แต่ละช่องสั่งปั๊มตัวไหน</h3>'
         f'<table class="grid"><thead><tr><th>ช่อง</th><th>GPIO</th><th>ชื่อในเว็บ</th><th>สูบจาก</th><th></th><th>ไปที่</th></tr></thead>'
         f'<tbody>{rr}</tbody></table>'
         f'<p class="note">ลูกลอยลังใดยกขึ้น เซิร์ฟเวอร์ปิด R1/R2 และ R5/R7 ของลังนั้นทันที ทั้งโหมด AUTO และ MANUAL</p></div>')
    C['pump'] = card('ปั๊มน้ำ DC 5V × 8', 'recv', pump(), [
        ('หน้าที่', 'สูบน้ำ / น้ำยา pH Down ระหว่างขวดกับลังปลูก'),
        ('รับจาก', arrow('รีเลย์') + ' ได้ไฟเมื่อรีเลย์ช่องนั้นติด'),
        ('ส่งไปที่', 'น้ำไปตามท่อ (ไม่ส่งข้อมูล) — ดูตารางหน้ารีเลย์'),
    ])
    C['lm'] = card('LM2596 (Step-down)', 'power', lm(), [
        ('หน้าที่', 'ลดแรงดันแบตเตอรี่ 12V (ชาร์จจากโซลาร์เซลล์) ให้เหลือ 5V'),
        ('รับจาก', 'แบตเตอรี่ 12V ผ่านเบรกเกอร์ DC'),
        ('ส่งไปที่', 'ไฟเลี้ยง ESP32 · เซ็นเซอร์ · รีเลย์ · ปั๊ม'),
    ])
    C['srv'] = card('เซิร์ฟเวอร์ Node.js (Render)', 'both', screen('web_render.png', 2049, 1200, [], ch=390), [
        ('รับจาก', arrow('ESP32') + ' ค่าเซ็นเซอร์ทุก 2 วิ · ' + arrow('เบราว์เซอร์') + ' คำสั่ง/การตั้งค่า'),
        ('ทำ', 'Auto Mode: โดส pH, Flood &amp; Drain, ตัดปั๊มเมื่อลูกลอยยก'),
        ('ส่งไปที่', arrow('ESP32') + ' relayStates · ' + arrow('เบราว์เซอร์') + ' Socket.io · ' + arrow('Supabase') + ' บันทึก'),
    ])
    C['sb'] = card('Supabase (ฐานข้อมูล)', 'both', screen('web_supabase.png', 2049, 1200, [], ch=390), [
        ('รับจาก', arrow('เซิร์ฟเวอร์') + ' ค่ารอบปลูกทุก 5 นาที, การตั้งค่า, ผู้ใช้'),
        ('ส่งไปที่', arrow('เซิร์ฟเวอร์') + ' โหลดกลับเมื่อรีสตาร์ต / เปิดรายงาน'),
    ])
    C['web'] = card('เว็บเบราว์เซอร์ (แดชบอร์ด)', 'both', browser(), [
        ('รับจาก', arrow('เซิร์ฟเวอร์') + ' ค่าเซ็นเซอร์ สถานะรีเลย์ ผ่าน Socket.io'),
        ('ส่งไปที่', arrow('เซิร์ฟเวอร์') + ' POST /api/relay, /api/mode, /api/auto-settings'),
    ])
    for keys, title, cls in [
        (('dht', 'bh'), 'เซ็นเซอร์สภาพแวดล้อม: อุณหภูมิ ความชื้น แสง', 'cards2'),
        (('ina', 'ph'), 'เซ็นเซอร์ไฟฟ้า และเซ็นเซอร์ pH', 'cards2'),
        (('sr', 'flt'), 'เซ็นเซอร์ระดับน้ำ: ขวด 4 ใบ และลังปลูก 2 ลัง', 'cards2'),
        (('relay', 'rtable'), 'ตัวรับคำสั่ง: รีเลย์ 8 ช่อง', 'cards2'),
        (('pump', 'lm'), 'ปั๊มน้ำ และไฟเลี้ยงระบบ', 'cards2'),
        (('srv', 'sb', 'web'), 'ส่วนบนคลาวด์: เซิร์ฟเวอร์ ฐานข้อมูล หน้าเว็บ', 'cards3'),
    ]:
        pages.append(page(f'<div class="{cls}">' + ''.join(C[k] for k in keys) + '</div>', len(pages) + 1, title))

    sr = ''.join(
        f'<tr><td><b>{esc(a)}</b></td><td>{esc(b)}</td><td><span class="role {ROLE[c][1]}">{ROLE[c][0]}</span></td>'
        f'<td>{esc(d)}</td><td>{esc(e)}</td></tr>' for a, b, c, d, e in SUMMARY)
    p7 = (f'<table class="grid summary"><thead><tr><th>อุปกรณ์</th><th>หน้าที่</th><th>บทบาท</th>'
          f'<th>ส่งไปที่</th><th>ช่องทาง / ขา</th></tr></thead><tbody>{sr}</tbody></table>')
    pages.append(page(p7, len(pages) + 1, 'ตารางสรุป: ใครส่ง ใครรับ'))

    css = open(os.path.join(os.path.dirname(__file__), 'style.css'), encoding='utf-8').read()
    doc = ('<!doctype html><html lang="th"><head><meta charset="utf-8">'
           '<title>การทำงานของอุปกรณ์</title>'
           '<link rel="preconnect" href="https://fonts.googleapis.com">'
           '<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai:wght@400;600;700&display=block" rel="stylesheet">'
           f'<style>{css}</style></head><body>{"".join(pages)}</body></html>')
    return doc

if __name__ == '__main__':
    here = os.path.dirname(os.path.abspath(__file__))
    out_html = os.path.join(here, 'index.html')
    with open(out_html, 'w', encoding='utf-8') as f:
        f.write(build())
    pdf = os.path.join(os.path.dirname(here), 'การทำงานของอุปกรณ์.pdf')
    edge = r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
    subprocess.run([edge, '--headless', '--disable-gpu', '--no-pdf-header-footer',
                    '--virtual-time-budget=8000', f'--print-to-pdf={pdf}', 'file:///' + out_html.replace('\\', '/')],
                   check=True)
    print('PDF:', pdf)
