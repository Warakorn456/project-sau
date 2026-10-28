# ดาต้าชีตอุปกรณ์ Smart Farm

รวบรวมเมื่อ 2026-10-28 · ทุกไฟล์ตรวจแล้วว่าเป็น PDF จริง (ไม่ใช่หน้าเว็บที่ดาวน์โหลดผิด)

| ไฟล์ | อุปกรณ์ | ใช้ทำอะไรในโปรเจกต์ | ผู้จัดทำเอกสาร | แหล่งที่มา |
|---|---|---|---|---|
| 01_ESP32-WROOM-32.pdf | ESP32-WROOM-32 (โมดูลบนบอร์ด DOIT DevKit V1) | ไมโครคอนโทรลเลอร์หลัก + WiFi | Espressif (ผู้ผลิต) | https://www.espressif.com/sites/default/files/documentation/esp32-wroom-32_datasheet_en.pdf |
| 02_ESP32_chip.pdf | ชิป ESP32 | ข้อมูลขา GPIO/ADC | Espressif (ผู้ผลิต) | https://www.espressif.com/sites/default/files/documentation/esp32_datasheet_en.pdf |
| 03_DHT11.pdf | DHT11 | อุณหภูมิ/ความชื้น (GPIO4) | Aosong (สำเนาที่ CUNY โฮสต์) | https://openlab.citytech.cuny.edu/cet4711/files/2018/05/DHT11.pdf |
| 04_BH1750FVI.pdf | BH1750FVI (โมดูล GY-302) | วัดแสง (I2C) | ROHM, Rev.D (สำเนาที่ WEMOS docs โฮสต์) | https://wemos-docs.readthedocs.io/en/latest/_static/files/bh1750fvi-tr.pdf |
| 05_INA219.pdf | INA219 | แรงดัน/กระแส/กำลัง (I2C) | Texas Instruments (ผู้ผลิต) | https://www.ti.com/lit/ds/symlink/ina219.pdf |
| 07_JSN-SR04T.pdf | JSN-SR04T (เทียบเท่า SR04M-2) | วัดระดับน้ำในขวด 4 ใบ | ผู้ขาย (สำเนาที่ Makerguides โฮสต์) | https://www.makerguides.com/wp-content/uploads/2019/02/JSN-SR04T-Datasheet.pdf |
| 09_SRD-05VDC-SL-C.pdf | รีเลย์ Songle SRD-05VDC-SL-C | รีเลย์บนบอร์ด 8 ช่อง | Songle (สำเนาที่ Circuit Basics โฮสต์) | https://www.circuitbasics.com/wp-content/uploads/2015/11/SRD-05VDC-SL-C-Datasheet.pdf |
| 10_PC817.pdf | PC817 optocoupler | ตัวแยกสัญญาณบนบอร์ดรีเลย์ | Sharp (สำเนาที่ Farnell โฮสต์) | https://www.farnell.com/datasheets/73758.pdf |
| 11_LM2596.pdf | LM2596 | step-down 12V → 5V | Texas Instruments (ผู้ผลิต) | https://www.ti.com/lit/ds/symlink/lm2596.pdf |
| 12_XL4016.pdf | XL4016 | step-down 12V → 5V | XLSEMI (สำเนาที่ ChipDip โฮสต์) | https://static.chipdip.ru/lib/594/DOC042594932.pdf |

## ไม่มีดาต้าชีตที่เชื่อถือได้
| อุปกรณ์ | เหตุผล |
|---|---|
| โมดูล pH PH-4502C + หัววัด E-201-C | ไม่มีผู้ผลิตที่ชัดเจน มีแค่หน้าร้านค้าซึ่งสเปกและขาไม่ตรงกัน |
| SR04M-2 (รุ่นที่ใช้จริง) | ไม่พบ PDF ของรุ่นนี้ ใช้ JSN-SR04T แทน เพราะใช้ trigger/echo แบบเดียวกัน |
| สวิตช์ลูกลอย | เป็นของทั่วไป ไม่มีรุ่น |
| ปั๊ม DC 3–5V × 8 | เป็นของทั่วไป ไม่มีรุ่น |
| แบต NPP NPG12-120Ah | หาไม่พบ (มีแค่รุ่น 200Ah/40Ah) — ลองหาที่ npp-power.eu หรือถามร้าน |
| ชาร์จเจอร์โซลาร์ PowMr | ยังไม่รู้รุ่น |

ตอนนี้ยังไม่ทราบว่าบนบอร์ดรีเลย์ใช้ PC817 จริงหรือไม่ เพราะเป็นแค่ชิ้นส่วนที่บอร์ดแบบนี้มักใช้ ให้ดูตัวอักษรบนชิปก่อนอ้างในเล่ม
