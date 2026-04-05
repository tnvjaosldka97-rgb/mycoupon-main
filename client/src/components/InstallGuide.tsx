import { useState } from 'react';
import { useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Download, Smartphone, Shield, CheckCircle, ChevronDown, ChevronUp } from 'lucide-react';

const ANDROID_DOWNLOAD_URL = '/api/download/android';

type Tab = 'android' | 'ios';

export default function InstallGuide() {
  const [, setLocation] = useLocation();
  const ua = navigator.userAgent;
  const detectedIOS = /iPad|iPhone|iPod/.test(ua);
  const [tab, setTab] = useState<Tab>(detectedIOS ? 'ios' : 'android');
  const [apkFaqOpen, setApkFaqOpen] = useState(false);

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-pink-50 to-purple-50">
      {/* 헤더 */}
      <div className="bg-white/80 backdrop-blur-md sticky top-0 z-10 border-b shadow-sm">
        <div className="container mx-auto px-4 py-4 flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setLocation('/')}
            className="p-2 hover:bg-orange-100"
          >
            <ArrowLeft className="w-5 h-5 text-orange-600" />
          </Button>
          <div className="flex items-center gap-2">
            <img src="/logo-bear-nobg.png" alt="마이쿠폰" className="w-8 h-8" />
            <h1 className="text-xl font-bold bg-gradient-to-r from-orange-500 to-pink-500 bg-clip-text text-transparent">
              앱 설치 안내
            </h1>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8 max-w-md">
        {/* 타이틀 */}
        <div className="text-center mb-8">
          <img src="/logo-bear-nobg.png" alt="마이쿠폰" className="w-20 h-20 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-gray-800 mb-2">마이쿠폰 설치하기</h2>
          <p className="text-gray-500 text-sm">내 주변 쿠폰을 앱에서 더 편리하게</p>
        </div>

        {/* 탭 선택 */}
        <div className="flex bg-white rounded-2xl p-1 mb-6 shadow-sm border border-gray-100">
          <button
            onClick={() => setTab('android')}
            className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold transition-all ${
              tab === 'android'
                ? 'bg-gradient-to-r from-green-500 to-emerald-500 text-white shadow-md'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M17.523 15.341a.54.54 0 01-.54.54H7.017a.54.54 0 01-.54-.54V8.66c0-.298.242-.54.54-.54h9.966c.298 0 .54.242.54.54v6.681zM7.49 5.58l1.219-2.112a.234.234 0 00-.086-.32.234.234 0 00-.32.086L7.057 5.398a7.597 7.597 0 00-3.092 1.973h12.07A7.597 7.597 0 0012.943 5.4L11.697 3.234a.234.234 0 00-.32-.086.234.234 0 00-.086.32L12.51 5.58H7.49zM9 10a1 1 0 100-2 1 1 0 000 2zm6 0a1 1 0 100-2 1 1 0 000 2z"/>
            </svg>
            Android
          </button>
          <button
            onClick={() => setTab('ios')}
            className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold transition-all ${
              tab === 'ios'
                ? 'bg-gradient-to-r from-blue-500 to-indigo-500 text-white shadow-md'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
            </svg>
            iPhone / iPad
          </button>
        </div>

        {/* Android 탭 */}
        {tab === 'android' && (
          <div className="space-y-4">
            {/* 다운로드 버튼 */}
            <a href={ANDROID_DOWNLOAD_URL} className="block">
              <div className="bg-gradient-to-r from-green-500 to-emerald-500 rounded-2xl p-5 text-white shadow-lg active:scale-[0.98] transition-transform">
                <div className="flex items-center gap-4">
                  <div className="bg-white/20 rounded-xl p-3">
                    <Download className="w-7 h-7" />
                  </div>
                  <div className="flex-1">
                    <div className="font-bold text-lg">APK 다운로드</div>
                    <div className="text-green-100 text-sm">Android 전용 앱 · 18.3MB</div>
                  </div>
                  <ChevronDown className="w-5 h-5 text-white/70 rotate-[-90deg]" />
                </div>
              </div>
            </a>

            {/* 설치 단계 */}
            <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
              <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2">
                <span className="text-base">📋</span> 설치 순서
              </h3>
              <ol className="space-y-4">
                {[
                  { step: '위 버튼을 눌러 APK 파일을 다운로드하세요', sub: '파일 크기: 18.3MB' },
                  { step: '"다운로드" 버튼을 눌러 저장하세요', sub: '경고 팝업이 뜨면 → 아래 FAQ 확인' },
                  { step: '다운로드된 파일을 열어 설치하세요', sub: '알림창에서 파일 탭 또는 파일 관리자에서 열기' },
                  { step: '"알 수 없는 앱 설치 허용"을 허용하세요', sub: '설정에서 허용 후 다시 설치 진행' },
                  { step: '설치 완료 후 앱 실행!', sub: '홈 화면에서 마이쿠폰 아이콘 탭' },
                ].map((item, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="flex-shrink-0 w-6 h-6 bg-gradient-to-r from-green-500 to-emerald-500 text-white rounded-full flex items-center justify-center text-xs font-bold mt-0.5">
                      {i + 1}
                    </span>
                    <div>
                      <div className="text-gray-800 text-sm font-medium">{item.step}</div>
                      <div className="text-gray-400 text-xs mt-0.5">{item.sub}</div>
                    </div>
                  </li>
                ))}
              </ol>
            </div>

            {/* FAQ - 보안 경고 안내 */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              <button
                onClick={() => setApkFaqOpen(v => !v)}
                className="w-full flex items-center justify-between p-5 text-left"
              >
                <div className="flex items-center gap-3">
                  <Shield className="w-5 h-5 text-amber-500" />
                  <span className="font-semibold text-gray-800 text-sm">
                    "이 파일이 기기에 손상을 줄 수 있습니다" 경고가 떴어요
                  </span>
                </div>
                {apkFaqOpen
                  ? <ChevronUp className="w-4 h-4 text-gray-400 flex-shrink-0" />
                  : <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" />
                }
              </button>
              {apkFaqOpen && (
                <div className="px-5 pb-5 space-y-3 border-t border-gray-50">
                  <p className="text-gray-600 text-sm pt-3">
                    Chrome이 <strong>Play Store 외부에서 받은 파일</strong>에 자동으로 표시하는 경고입니다.
                    마이쿠폰 APK는 악성 코드가 없는 안전한 파일입니다.
                  </p>
                  <div className="bg-amber-50 rounded-xl p-3 space-y-2">
                    <p className="text-amber-800 text-xs font-semibold">경고 팝업에서 이렇게 하세요:</p>
                    <ol className="text-amber-700 text-xs space-y-1">
                      <li>① 팝업 하단 <strong>"다운로드"</strong> 버튼 탭</li>
                      <li>② 또는 <strong>"자세히"</strong> → <strong>"그래도 다운로드"</strong> 선택</li>
                    </ol>
                  </div>
                  <div className="flex items-start gap-2 bg-green-50 rounded-xl p-3">
                    <CheckCircle className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
                    <p className="text-green-700 text-xs">
                      출처: <strong>release-assets.githubusercontent.com</strong> (GitHub 공식 서버) — 신뢰할 수 있는 출처입니다
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* 신뢰 배지 */}
            <div className="flex items-center justify-center gap-4 py-2">
              <div className="flex items-center gap-1.5 text-gray-400 text-xs">
                <Shield className="w-3.5 h-3.5" />
                <span>바이러스 없음</span>
              </div>
              <span className="text-gray-200">|</span>
              <div className="flex items-center gap-1.5 text-gray-400 text-xs">
                <CheckCircle className="w-3.5 h-3.5" />
                <span>GitHub 공식 배포</span>
              </div>
              <span className="text-gray-200">|</span>
              <div className="flex items-center gap-1.5 text-gray-400 text-xs">
                <Smartphone className="w-3.5 h-3.5" />
                <span>Android 7.0+</span>
              </div>
            </div>
          </div>
        )}

        {/* iOS 탭 */}
        {tab === 'ios' && (
          <div className="space-y-4">
            {/* 안내 배너 */}
            <div className="bg-gradient-to-r from-blue-500 to-indigo-500 rounded-2xl p-5 text-white shadow-lg">
              <div className="flex items-center gap-4">
                <div className="bg-white/20 rounded-xl p-3">
                  <Smartphone className="w-7 h-7" />
                </div>
                <div>
                  <div className="font-bold text-lg">홈 화면에 추가</div>
                  <div className="text-blue-100 text-sm">Safari에서 1분이면 완료돼요</div>
                </div>
              </div>
            </div>

            {/* Safari 필수 안내 */}
            <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 flex items-start gap-3">
              <span className="text-xl flex-shrink-0">⚠️</span>
              <div>
                <p className="text-blue-800 font-semibold text-sm">Safari 브라우저에서만 가능해요</p>
                <p className="text-blue-600 text-xs mt-1">
                  카카오톡·인스타 등 인앱 브라우저에서는 안 됩니다.<br/>
                  오른쪽 하단 <strong>···</strong> → <strong>Safari로 열기</strong>를 먼저 눌러주세요.
                </p>
              </div>
            </div>

            {/* 설치 단계 */}
            <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
              <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2">
                <span className="text-base">📋</span> Safari에서 설치하는 방법
              </h3>
              <ol className="space-y-5">
                {[
                  {
                    step: 'Safari에서 이 페이지를 열어주세요',
                    sub: 'my-coupon-bridge.com',
                    icon: '🌐',
                  },
                  {
                    step: '하단 가운데 공유 버튼을 탭하세요',
                    sub: '네모 위에 화살표 올라가는 아이콘 ⬆',
                    icon: '📤',
                  },
                  {
                    step: '"홈 화면에 추가"를 탭하세요',
                    sub: '스크롤을 내리면 보여요',
                    icon: '➕',
                  },
                  {
                    step: '오른쪽 상단 "추가"를 탭하면 완료!',
                    sub: '홈 화면에 마이쿠폰 아이콘이 생겨요',
                    icon: '✅',
                  },
                ].map((item, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="flex-shrink-0 w-6 h-6 bg-gradient-to-r from-blue-500 to-indigo-500 text-white rounded-full flex items-center justify-center text-xs font-bold mt-0.5">
                      {i + 1}
                    </span>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-base">{item.icon}</span>
                        <span className="text-gray-800 text-sm font-medium">{item.step}</span>
                      </div>
                      <div className="text-gray-400 text-xs mt-0.5 ml-7">{item.sub}</div>
                    </div>
                  </li>
                ))}
              </ol>
            </div>

            {/* iOS 앱스토어 예정 안내 */}
            <div className="bg-gray-50 border border-gray-200 rounded-2xl p-4 flex items-start gap-3">
              <span className="text-xl flex-shrink-0">🍎</span>
              <div>
                <p className="text-gray-700 font-semibold text-sm">App Store 출시 예정</p>
                <p className="text-gray-500 text-xs mt-1">
                  현재 App Store 심사 준비 중입니다.<br/>
                  출시 전까지 홈 화면 추가로 동일하게 사용하실 수 있어요.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* 하단 */}
        <div className="mt-8 text-center">
          <Button
            onClick={() => setLocation('/')}
            variant="outline"
            className="border-orange-200 text-orange-600 hover:bg-orange-50 px-8 rounded-xl"
          >
            홈으로 돌아가기
          </Button>
        </div>
      </div>
    </div>
  );
}
