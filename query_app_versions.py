import os
import mysql.connector
from urllib.parse import urlparse, parse_qs

# DATABASE_URL 파싱
db_url = os.environ.get('DATABASE_URL', '')

if db_url.startswith('mysql://'):
    parsed = urlparse(db_url)
    
    conn = mysql.connector.connect(
        host=parsed.hostname,
        port=parsed.port or 3306,
        user=parsed.username,
        password=parsed.password,
        database=parsed.path.lstrip('/').split('?')[0],  # ? 이후 파라미터 제거
        ssl_disabled=False
    )
    
    cursor = conn.cursor(dictionary=True)
    cursor.execute("""
        SELECT id, version, minVersion, recommendedVersion, updateMode, 
               updateMessage, updateUrl, isActive, createdAt, updatedAt 
        FROM app_versions 
        ORDER BY id
    """)
    
    rows = cursor.fetchall()
    
    print("=" * 100)
    print("app_versions 테이블 원본 데이터 (테스트 전)")
    print("=" * 100)
    for row in rows:
        print(f"\nID: {row['id']}")
        print(f"  version: {row['version']}")
        print(f"  minVersion: {row['minVersion']}")
        print(f"  recommendedVersion: {row['recommendedVersion']}")
        print(f"  updateMode: {row['updateMode']}")
        print(f"  updateMessage: {row['updateMessage']}")
        print(f"  updateUrl: {row['updateUrl']}")
        print(f"  isActive: {row['isActive']}")
        print(f"  createdAt: {row['createdAt']}")
        print(f"  updatedAt: {row['updatedAt']}")
    print("=" * 100)
    
    # 파일로 저장
    with open('/home/ubuntu/app_versions_backup.txt', 'w') as f:
        f.write("app_versions 테이블 원본 데이터 (테스트 전)\n")
        f.write("=" * 100 + "\n")
        for row in rows:
            f.write(f"\nID: {row['id']}\n")
            f.write(f"  version: {row['version']}\n")
            f.write(f"  minVersion: {row['minVersion']}\n")
            f.write(f"  recommendedVersion: {row['recommendedVersion']}\n")
            f.write(f"  updateMode: {row['updateMode']}\n")
            f.write(f"  updateMessage: {row['updateMessage']}\n")
            f.write(f"  updateUrl: {row['updateUrl']}\n")
            f.write(f"  isActive: {row['isActive']}\n")
            f.write(f"  createdAt: {row['createdAt']}\n")
            f.write(f"  updatedAt: {row['updatedAt']}\n")
        f.write("=" * 100 + "\n")
    
    cursor.close()
    conn.close()
    
    print("\n백업 파일 저장 완료: /home/ubuntu/app_versions_backup.txt")
else:
    print("DATABASE_URL 환경변수를 찾을 수 없습니다.")
