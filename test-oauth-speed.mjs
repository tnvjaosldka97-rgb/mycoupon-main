import http from 'http';

/**
 * OAuth 콜백 속도 측정 테스트
 * 실제 OAuth 플로우를 시뮬레이션하여 응답 속도를 측정합니다.
 */

const PORT = 3002;
const HOST = 'localhost';

// 테스트용 더미 데이터 (실제 OAuth 서버는 호출하지 않음)
const TEST_CODE = 'test_code_12345';
const TEST_STATE = Buffer.from('http://localhost:3002/').toString('base64');

async function measureOAuthCallbackSpeed() {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    
    const options = {
      hostname: HOST,
      port: PORT,
      path: `/api/oauth/callback?code=${TEST_CODE}&state=${TEST_STATE}`,
      method: 'GET',
      headers: {
        'User-Agent': 'OAuth-Speed-Test/1.0'
      }
    };

    const req = http.request(options, (res) => {
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        resolve({
          duration,
          statusCode: res.statusCode,
          headers: res.headers,
          body: data
        });
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.end();
  });
}

async function runTests(count = 5, interval = 10000) {
  console.log(`\n🚀 OAuth 콜백 속도 측정 시작 (${count}회 테스트, ${interval/1000}초 간격)\n`);
  console.log('=' .repeat(70));
  
  const results = [];
  
  for (let i = 1; i <= count; i++) {
    try {
      console.log(`\n[테스트 ${i}/${count}] 측정 중...`);
      const result = await measureOAuthCallbackSpeed();
      results.push(result.duration);
      
      console.log(`✅ 응답 시간: ${result.duration}ms`);
      console.log(`   상태 코드: ${result.statusCode}`);
      
      if (result.duration <= 500) {
        console.log(`   🎉 목표 달성! (${result.duration}ms < 500ms)`);
      } else {
        console.log(`   ⚠️  목표 미달 (${result.duration}ms > 500ms)`);
      }
      
      // 마지막 테스트가 아니면 대기
      if (i < count) {
        console.log(`\n⏳ ${interval/1000}초 대기 중...`);
        await new Promise(resolve => setTimeout(resolve, interval));
      }
    } catch (error) {
      console.error(`❌ 테스트 ${i} 실패:`, error.message);
    }
  }
  
  // 통계 출력
  console.log('\n' + '='.repeat(70));
  console.log('\n📊 측정 결과 통계\n');
  
  const avg = results.reduce((a, b) => a + b, 0) / results.length;
  const min = Math.min(...results);
  const max = Math.max(...results);
  const successCount = results.filter(d => d <= 500).length;
  
  console.log(`총 테스트 횟수: ${results.length}회`);
  console.log(`평균 응답 시간: ${avg.toFixed(0)}ms`);
  console.log(`최소 응답 시간: ${min}ms`);
  console.log(`최대 응답 시간: ${max}ms`);
  console.log(`목표 달성률: ${successCount}/${results.length} (${(successCount/results.length*100).toFixed(1)}%)`);
  
  console.log('\n' + '='.repeat(70));
  
  if (avg <= 500) {
    console.log('\n🎉 성공! 평균 응답 시간이 0.5초 이하입니다.');
  } else {
    console.log(`\n⚠️  실패! 평균 응답 시간이 목표(500ms)를 초과했습니다: ${avg.toFixed(0)}ms`);
  }
  
  console.log('\n');
}

// 테스트 실행
runTests(5, 10000).catch(console.error);
