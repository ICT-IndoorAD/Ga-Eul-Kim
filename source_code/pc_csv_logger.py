import time
import serial
import csv
from datetime import datetime

PORT = "COM4"        # 환경에 맞게 변경 (Mac/Linux는 예: /dev/ttyUSB0, /dev/cu.usbmodemXXXX)
BAUD = 9600
OUTPUT_FILE = "air_log.csv"   # 열 구성이 달라져서 기존 dht_log.csv와 파일을 분리함

# 아두이노가 보내는 순서와 동일
COLUMNS = [
    "dht_temp_C",
    "dht_humi_pct",
    "am_temp_C",
    "am_humi_pct",
    "co2_ppm",
    "voc_level",
    "pm25_ugm3",
]


def is_number_or_blank(s):
    """빈칸(센서 읽기 실패)이거나 숫자면 True. 헤더 줄 같은 문자열은 False."""
    s = s.strip()
    if s == "":
        return True
    try:
        float(s)
        return True
    except ValueError:
        return False


def parse_line(line):
    """아두이노 한 줄 -> 값 리스트. 형식이 맞지 않으면(헤더 줄, 깨진 줄 등) None."""
    parts = [p.strip() for p in line.split(",")]
    if len(parts) != len(COLUMNS):
        return None
    if not all(is_number_or_blank(p) for p in parts):
        return None
    if all(p == "" for p in parts):      # 모든 센서가 실패한 줄은 저장하지 않음
        return None
    return parts


def main():
    ser = serial.Serial(PORT, BAUD, timeout=2)
    time.sleep(2)                 # 포트를 열면 아두이노가 리셋되므로 잠시 대기
    ser.reset_input_buffer()

    with open(OUTPUT_FILE, "a", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        if f.tell() == 0:
            writer.writerow(["timestamp"] + COLUMNS)

        print(f"{OUTPUT_FILE}에 저장을 시작합니다. (Ctrl+C로 종료)")
        try:
            while True:
                line = ser.readline().decode("utf-8", errors="ignore").strip()
                if not line:
                    continue
                values = parse_line(line)
                if values is None:
                    continue
                timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                writer.writerow([timestamp] + values)
                f.flush()
                print(timestamp, *values)
        except KeyboardInterrupt:
            print("종료합니다.")
        finally:
            ser.close()


if __name__ == "__main__":
    main()
