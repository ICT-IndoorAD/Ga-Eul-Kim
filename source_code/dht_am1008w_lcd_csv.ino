#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <DHT.h>

// ===== 핀 설정 =====
#define DHTPIN 2
#define DHTTYPE DHT11   // DHT22를 쓴다면 DHT22로 변경

#define RED_PIN 9
#define GREEN_PIN 10
#define BLUE_PIN 11

// AM1008W-K (I2C 버전): SDA -> A4, SCL -> A5, 주소 0x28 (LCD 0x27과 같은 버스 공유)
#define AM_I2C_ADDR 0x28
#define AM_FRAME_LEN 25

// ===== 옵션 =====
#define PRINT_CSV_HEADER 1   // 1: 시작할 때 CSV 헤더 한 줄 출력, 0: 출력 안 함
#define PAGE_SECONDS 3       // LCD 화면 전환 간격(초)

LiquidCrystal_I2C lcd(0x27, 16, 2);  // 화면이 안 나오면 0x3F로 변경
DHT dht(DHTPIN, DHTTYPE);

struct AMData {
  uint16_t co2;    // ppm
  uint16_t voc;    // 0~3 level
  uint16_t pm25;   // ug/m3
  float temp;      // 섭씨
  float humi;      // %RH
};

void setColor(bool r, bool g, bool b) {
  digitalWrite(RED_PIN, r ? HIGH : LOW);
  digitalWrite(GREEN_PIN, g ? HIGH : LOW);
  digitalWrite(BLUE_PIN, b ? HIGH : LOW);
}

// LCD 한 줄(16칸)을 공백으로 채워서 출력 (이전 글자 잔상 방지)
void lcdLine(uint8_t row, const char *s) {
  lcd.setCursor(0, row);
  uint8_t n = 0;
  while (s[n] && n < 16) {
    lcd.write((uint8_t)s[n]);
    n++;
  }
  while (n < 16) {
    lcd.write(' ');
    n++;
  }
}

// AM1008W-K I2C 측정값 읽기 (성공하면 true)
// 응답 25바이트: 16 19 [모드] [CO2 2B] [VOC 2B] [습도 2B] [온도 2B] [PM1.0 2B] [PM2.5 2B] [PM10 2B] ... [CS(XOR)]
bool readAM1008W(AMData &d) {
  uint8_t buf[AM_FRAME_LEN];
  uint8_t n = 0;

  Wire.requestFrom((uint8_t)AM_I2C_ADDR, (uint8_t)AM_FRAME_LEN);
  while (Wire.available() && n < AM_FRAME_LEN) {
    buf[n++] = Wire.read();
  }
  while (Wire.available()) Wire.read();            // 남은 바이트 비우기

  if (n < AM_FRAME_LEN) return false;              // 응답 부족
  if (buf[0] != 0x16) return false;                // 헤더 확인
  if (buf[1] != AM_FRAME_LEN) return false;        // 길이 확인

  uint8_t cs = buf[0];                             // 체크섬: 앞 24바이트 XOR == 마지막 바이트
  for (uint8_t i = 1; i < AM_FRAME_LEN - 1; i++) cs ^= buf[i];
  if (cs != buf[AM_FRAME_LEN - 1]) return false;

  int rawHumi = ((int)buf[7] << 8) | buf[8];
  int rawTemp = ((int)buf[9] << 8) | buf[10];

  d.co2  = ((uint16_t)buf[3] << 8) | buf[4];
  d.voc  = ((uint16_t)buf[5] << 8) | buf[6];
  d.humi = rawHumi / 10.0;
  d.temp = (rawTemp - 500) / 10.0;                 // 실제값 + 500 으로 전송됨
  d.pm25 = ((uint16_t)buf[13] << 8) | buf[14];
  return true;
}

// LCD 3페이지: 0 = DHT, 1 = AM1008W 온습도, 2 = CO2 / VOC / PM2.5
void showPage(uint8_t page, bool dhtOk, float t, float h, bool amOk, const AMData &am) {
  char l1[17], l2[17], a[8], b[8];
  l1[0] = 0;
  l2[0] = 0;

  if (page == 0) {
    if (dhtOk) {
      dtostrf(t, 1, 1, a);
      dtostrf(h, 1, 1, b);
      snprintf(l1, sizeof(l1), "DHT T:%s%cC", a, 223);   // 223 = 도(degree) 기호
      snprintf(l2, sizeof(l2), "DHT H:%s%%", b);
    } else {
      snprintf(l1, sizeof(l1), "DHT Sensor Error");
    }
  } else if (page == 1) {
    if (amOk) {
      dtostrf(am.temp, 1, 1, a);
      dtostrf(am.humi, 1, 1, b);
      snprintf(l1, sizeof(l1), "AM1008 T:%s%cC", a, 223);
      snprintf(l2, sizeof(l2), "AM1008 H:%s%%", b);
    } else {
      snprintf(l1, sizeof(l1), "AM1008W Error");
      snprintf(l2, sizeof(l2), "Check wiring");
    }
  } else {
    if (amOk) {
      snprintf(l1, sizeof(l1), "CO2:%uppm", (unsigned)am.co2);
      snprintf(l2, sizeof(l2), "VOC:%u PM2.5:%u", (unsigned)am.voc, (unsigned)am.pm25);
    } else {
      snprintf(l1, sizeof(l1), "AM1008W Error");
      snprintf(l2, sizeof(l2), "Check wiring");
    }
  }

  lcdLine(0, l1);
  lcdLine(1, l2);
}

// ===== 공기질 등급 (0 = 좋음, 1 = 보통, 2 = 나쁨, 3 = 매우 나쁨) =====
uint8_t levelTemp(float t) {
  if (t >= 20.0 && t < 26.0) return 0;
  if (t >= 18.0 && t < 28.0) return 1;
  if (t >= 15.0 && t < 30.0) return 2;
  return 3;
}

uint8_t levelHumi(float h) {
  if (h >= 40.0 && h <= 60.0) return 0;
  if (h >= 30.0 && h <= 70.0) return 1;
  if (h >= 20.0 && h <= 80.0) return 2;
  return 3;
}

uint8_t levelCo2(uint16_t c) {
  if (c < 800) return 0;
  if (c < 1000) return 1;
  if (c < 1500) return 2;
  return 3;
}

uint8_t levelVoc(uint16_t v) {      // 센서 값 0~3
  if (v <= 1) return 0;
  if (v == 2) return 1;
  return 2;
}

uint8_t levelPm25(uint16_t p) {
  if (p <= 15) return 0;
  if (p <= 35) return 1;
  if (p <= 75) return 2;
  return 3;
}

uint8_t maxLevel(uint8_t a, uint8_t b) {
  return a > b ? a : b;
}

void setup() {
  Serial.begin(9600);
  Wire.begin();
  lcd.init();
  lcd.backlight();
  dht.begin();

  pinMode(RED_PIN, OUTPUT);
  pinMode(GREEN_PIN, OUTPUT);
  pinMode(BLUE_PIN, OUTPUT);
  setColor(0, 0, 0);

  lcdLine(0, "Ready");
  lcdLine(1, "");
  delay(1000);
  lcd.clear();

#if PRINT_CSV_HEADER
  Serial.println(F("dht_temp_C,dht_humi_pct,am_temp_C,am_humi_pct,co2_ppm,voc_level,pm25_ugm3"));
#endif
}

void loop() {
  static uint8_t tick = 0;   // 0 ~ (PAGE_SECONDS * 3 - 1)

  float h = dht.readHumidity();
  float t = dht.readTemperature();
  bool dhtOk = !(isnan(h) || isnan(t));

  AMData am;
  bool amOk = readAM1008W(am);

  // LCD 표시 (3초마다 페이지 전환)
  uint8_t page = tick / PAGE_SECONDS;
  tick = (tick + 1) % (PAGE_SECONDS * 3);
  showPage(page, dhtOk, t, h, amOk, am);

  // 모든 센서(DHT 온습도, AM1008W 온습도/CO2/VOC/PM2.5)의 등급 중 가장 나쁜 등급으로 LED 색 결정
  // 0 좋음 = 초록, 1 보통 = 노랑, 2 나쁨 = 빨강, 3 매우 나쁨 = 보라, 센서 전부 실패 = 꺼짐
  if (!dhtOk && !amOk) {
    setColor(0, 0, 0);
  } else {
    uint8_t lv = 0;
    if (dhtOk) {
      lv = maxLevel(lv, levelTemp(t));
      lv = maxLevel(lv, levelHumi(h));
    }
    if (amOk) {
      lv = maxLevel(lv, levelTemp(am.temp));
      lv = maxLevel(lv, levelHumi(am.humi));
      lv = maxLevel(lv, levelCo2(am.co2));
      lv = maxLevel(lv, levelVoc(am.voc));
      lv = maxLevel(lv, levelPm25(am.pm25));
    }

    if (lv == 0) setColor(0, 1, 0);        // 좋음: 초록
    else if (lv == 1) setColor(1, 1, 0);   // 보통: 노랑
    else if (lv == 2) setColor(1, 0, 0);   // 나쁨: 빨강
    else setColor(1, 0, 1);                // 매우 나쁨: 보라
  }

  // PC로 CSV 전송: dht온도,dht습도,am온도,am습도,co2,voc,pm2.5
  // 읽기에 실패한 항목은 빈칸으로 출력 (행은 항상 1초마다 1줄)
  if (dhtOk) Serial.print(t, 1);
  Serial.print(',');
  if (dhtOk) Serial.print(h, 1);
  Serial.print(',');
  if (amOk) Serial.print(am.temp, 1);
  Serial.print(',');
  if (amOk) Serial.print(am.humi, 1);
  Serial.print(',');
  if (amOk) Serial.print(am.co2);
  Serial.print(',');
  if (amOk) Serial.print(am.voc);
  Serial.print(',');
  if (amOk) Serial.print(am.pm25);
  Serial.println();

  delay(1000);
}
