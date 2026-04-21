import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface MerchantTermsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function ConsentBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 my-4">
      <p className="text-[11px] font-bold text-amber-700 mb-1.5 tracking-wide">
        ★ 사장님 동의 필수 박스
      </p>
      <p className="text-sm font-semibold text-amber-900 leading-relaxed">
        “{children}”
      </p>
    </div>
  );
}

function ChapterTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-base font-extrabold text-foreground mt-7 first:mt-0 pb-1.5 border-b border-border/60">
      {children}
    </h3>
  );
}

function ArticleTitle({ children }: { children: React.ReactNode }) {
  return (
    <h4 className="text-sm font-bold text-foreground mt-5">{children}</h4>
  );
}

function Paragraph({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[13px] leading-relaxed text-foreground/85">{children}</p>
  );
}

function SubItem({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[13px] leading-relaxed text-foreground/85 pl-4">
      {children}
    </p>
  );
}

function Callout({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[13px] font-semibold text-foreground bg-primary/5 border border-primary/20 rounded-lg px-3 py-2 my-2">
      {children}
    </p>
  );
}

export function MerchantTermsModal({
  open,
  onOpenChange,
}: MerchantTermsModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl w-[calc(100%-1.5rem)] max-h-[85vh] p-0 gap-0 flex flex-col">
        <DialogHeader className="px-5 sm:px-6 pt-6 pb-4 border-b text-left">
          <DialogTitle className="text-base sm:text-lg leading-snug">
            마이쿠폰 사업주 약관·개인정보 동의 모음
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            가맹점 서비스 이용약관, 회원가입 수집·이용 동의, 마케팅 수신 동의를
            한 곳에 모아 안내드립니다.
          </DialogDescription>
        </DialogHeader>

        <div className="overflow-y-auto px-5 sm:px-6 py-5">
          {/* ── PART 1. 서비스 이용 및 정기결제 약관 ───────────────── */}
          <div className="rounded-lg bg-primary/5 border border-primary/20 px-3 py-2 mb-4">
            <p className="text-[11px] font-bold text-primary/80 tracking-widest">
              PART 1
            </p>
            <p className="text-sm font-bold text-foreground">
              가맹점 서비스 이용 및 정기결제 약관
            </p>
          </div>

          <ConsentBox>
            마이쿠폰 가맹점 서비스 이용약관에 모두 동의합니다. (필수)
          </ConsentBox>

          {/* 제1장 */}
          <ChapterTitle>제1장 총칙</ChapterTitle>

          <ArticleTitle>제1조 (목적)</ArticleTitle>
          <Paragraph>
            본 약관은 마이쿠폰(이하 “회사”)이 제공하는 위치기반 할인 쿠폰 추천
            플랫폼 및 제반 서비스의 이용과 관련하여, 회사와 가맹점 회원(이하
            “회원”) 간의 권리, 의무, 책임 소재 및 서비스 이용 조건, 정기결제,
            환불 등에 관한 구체적인 사항을 규정함을 목적으로 합니다.
          </Paragraph>

          <ArticleTitle>제2조 (용어의 정의) — 정리본</ArticleTitle>
          <Paragraph>
            ① <strong>“서비스”</strong>란 회사가 제공하는 어플리케이션을 통하여
            회원의 매장 정보 및 할인 쿠폰을 특정 위치 반경 내 이용자에게
            노출하고 발급하는 제반 기능을 의미합니다.
          </Paragraph>
          <Paragraph>
            ② <strong>“정기결제(구독)”</strong>란 회원이 유료 구독 패키지를
            이용하기 위하여 등록한 결제 수단을 통해 1개월 단위로 서비스 이용
            요금이 자동 청구·결제되는 방식을 의미합니다.
          </Paragraph>
          <Paragraph>
            ③ <strong>“구독 서비스”</strong>란 회사가 제공하는 플랫폼 입점,
            매장 노출, 쿠폰 홍보 기능 이용 권한 등 서비스 이용 권리를 의미하며,
            이는 쿠폰 발송권의 구매와는 별개의 유료 서비스입니다.
          </Paragraph>
          <Paragraph>
            ④ <strong>“쿠폰 발송권”</strong>이란 이용자에게 쿠폰을 노출·발송할
            수 있는 권리를 의미합니다.
          </Paragraph>
          <Paragraph>
            ⑤ <strong>“구독 혜택 쿠폰”</strong>이란 회원이 정기결제를
            정상적으로 유지하는 조건으로 제공되는 조건부 결합 재화로서, 구독
            패키지에 포함되어 제공되는 쿠폰 발송권을 의미합니다.
          </Paragraph>
          <Paragraph>
            ⑥ <strong>“개별 충전 쿠폰”</strong>이란 구독 혜택과 별도로 회원이
            추가 요금을 지급하고 구매하는 유료 쿠폰 발송권을 의미합니다.
          </Paragraph>
          <Paragraph>
            ⑦ <strong>“정상 판매가”</strong>란 쿠폰 발송권을 단건으로 개별
            구매하는 경우 적용되는 1건당 990원(부가세 포함)의 가격을 의미합니다.
          </Paragraph>

          {/* 제2장 */}
          <ChapterTitle>제2장 서비스 이용 및 정기과금</ChapterTitle>

          <ConsentBox>
            매월 지정된 일자에 구독 요금이 자동 결제되는 것에 동의합니다. (필수)
          </ConsentBox>

          <ArticleTitle>제3조 (정기결제 및 결제 수단 관리)</ArticleTitle>
          <Paragraph>
            ① 회원은 서비스 이용을 위해 본인 명의의 유효한 신용카드 등 회사가
            인정하는 결제 수단을 등록해야 합니다.
          </Paragraph>
          <Paragraph>
            ② 정기결제는 매월 동일한 일자에 사전 등록된 결제 수단으로 자동
            청구됩니다.
          </Paragraph>
          <Paragraph>
            ③ 회원의 신용카드 한도 초과, 유효기간 만료, 분실 등의 사유로
            정상적인 결제가 이루어지지 않을 경우, 회사는 결제 실패 사실을
            회원에게 통지한 후 서비스 이용을 제한할 수 있습니다. 이로 인해
            발생한 회원의 손해에 대해 회사의 고의 또는 중과실이 없는 한 책임을
            지지 않습니다.
          </Paragraph>

          <ArticleTitle>제3-1조 (정기구독 패키지 구성)</ArticleTitle>
          <Paragraph>
            ① 각 구독 패키지(손님마중, 북적북적, 줄세우기 등)는 플랫폼 입점 및
            매장 노출 권리를 포함한 구독 서비스와 함께, 회사가 정한 정책에 따라
            일정 수량의 쿠폰 발송권을 포함할 수 있습니다.
          </Paragraph>
          <Paragraph>
            ② 구독 패키지에 포함되는 쿠폰 발송권의 구체적인 수량은 서비스 화면
            또는 상품 안내 페이지에 표시된 내용에 따릅니다.
          </Paragraph>
          <Paragraph>
            ③ 구독 패키지에 포함되어 제공되는 쿠폰 발송권은 제2조 제4항에 따른
            정상 판매가 1건당 990원의 유료 재화를 일정 조건 하에 제공하는
            것입니다.
          </Paragraph>

          <ArticleTitle>제4조 (정기결제 사전 고지 의무)</ArticleTitle>
          <Paragraph>
            회사는 관련 지침에 의거하여, 매월 정기결제가 이루어지기 7일 전까지
            회원에게 결제 예정 금액, 결제일, 해지 방법 등을 앱 내 푸시 알림,
            이메일, 카카오알림톡 등의 방법으로 사전 고지합니다. 회원의 연락처
            오기재, 수신 거부 등으로 인하여 고지가 도달하지 않은 경우 회사는
            책임을 지지 않습니다.
          </Paragraph>

          {/* 제3장 */}
          <ChapterTitle>제3장 쿠폰의 소멸 및 해지/환불</ChapterTitle>

          <ConsentBox>
            당월 미사용 쿠폰 소멸 정책 및 중도 해지 위약금(사용 쿠폰당 990원
            차감) 산정 방식에 동의합니다. (필수)
          </ConsentBox>

          <ArticleTitle>제5조 (쿠폰 미사용분 자동 소멸 및 보상 불가)</ArticleTitle>
          <Paragraph>
            ① 구독 패키지에 따라 당월 결제 주기에 제공되거나 보유하게 된 쿠폰
            발송권은 해당 결제 주기의 마지막 날 23시 59분에 자동 소멸됩니다.
            미사용 수량은 익월로 이월되지 않으며, 현금으로 환불되지 않습니다.
          </Paragraph>
          <Paragraph>
            ② 회원이 별도로 구매(충전)한 쿠폰 발송권의 유효기간은 결제일로부터
            1년으로 하며, 해당 유효기간 내 사용하지 않은 경우 자동 소멸됩니다.
            단, 쿠폰 발송 기능은 구독 서비스가 정상적으로 유지 중인 상태에서만
            활성화됩니다.
          </Paragraph>
          <Paragraph>
            ③ 회원의 단순 변심, 디바이스 조작 미숙, 앱 미접속, 내부 영업 전략
            변경 등 회원의 귀책 사유로 인해 쿠폰 발송권을 사용하지 못한 경우,
            회사는 이에 대한 환불 또는 보상 의무를 부담하지 않습니다.
          </Paragraph>
          <Paragraph>
            ④ 다만, 회사의 고의 또는 중과실로 인하여 쿠폰 발송 기능이
            정상적으로 제공되지 못한 경우에는, 회사는 해당 사유가 발생한 기간
            및 범위를 고려하여 합리적인 범위 내에서 사용 기간 연장 또는 이에
            상응하는 조치를 취합니다.
          </Paragraph>
          <Paragraph>
            ⑤ 천재지변, 통신사 장애, 불가항력적 시스템 장애 등 회사의 책임 없는
            사유로 인한 일시적 서비스 제한의 경우에는 제4항의 보상 대상에
            해당하지 않습니다.
          </Paragraph>

          <ArticleTitle>제6조 (구독 해지 및 중도 환불 규정)</ArticleTitle>
          <Paragraph>
            ① 구독 서비스의 월 정기결제 요금은 플랫폼 입점, 매장 노출 및 쿠폰
            홍보 기능 이용 권리에 대한 대가입니다.
          </Paragraph>
          <Paragraph>
            ② 회원은 서비스 앱 내 [마이페이지 &gt; 구독 관리] 메뉴를 통해
            언제든지 구독 해지를 신청할 수 있으며, 다음 각 호 중 하나를 선택할
            수 있습니다.
          </Paragraph>
          <SubItem>
            가. <strong>자동결제 해지(예약 해지)</strong>: 다음 결제일부터
            자동결제를 중단하는 방식으로, 이미 결제된 당월 이용 기간 동안은
            서비스 이용이 유지되며 별도의 환불은 발생하지 않습니다.
          </SubItem>
          <SubItem>
            나. <strong>즉시 해지 및 환불 요청</strong>: 해지 신청 즉시 구독
            서비스 이용이 종료되며, 본 조 제3항에 따른 환불 및 정산 절차가
            진행됩니다.
          </SubItem>
          <Paragraph>
            ③ 제2항 나호에 따른 즉시 해지 시 환불 금액은 아래 산식에 따라
            산정합니다. 환불 계산의 일관성을 위하여 1개월은 30일로 간주하여
            산정합니다.
          </Paragraph>
          <SubItem>
            가. 환불 대상 금액: 월 결제 금액 × (당월 잔여 일수 ÷ 30)
          </SubItem>
          <SubItem>
            나. 정산 금액: 당월 회원(가맹점)의 계정에서 실제 발행되어 한도가
            차감(소진)된 구독 혜택 쿠폰 발송권 수량 × 제2조에 따른 정상 판매가
            1건당 990원(부가세 포함)
          </SubItem>
          <Callout>
            ▶ 최종 환불 금액 = 가(환불 대상 금액) − 나(정산 금액)
          </Callout>
          <Paragraph>
            ④ 구독 패키지에 포함되어 제공되는 쿠폰 발송권은 구독 서비스의
            정상적인 유지 및 이용을 전제로 함께 제공되는 조건부 결합 재화입니다.
            회원이 결제 주기 중간에 즉시 해지를 선택하는 경우 해당 유지 조건이
            종료되므로, 시스템상 소진된 쿠폰 발송권에 대하여는 정상 판매가
            기준으로 정산이 이루어집니다. 이는 위약금이 아닌, 조건부 제공 재화의
            정산에 해당합니다.
          </Paragraph>
          <Paragraph>
            ⑤ 제3항의 산식에 따라 계산된 최종 환불 금액이 0원 이하일 경우
            환불금은 발생하지 않으며, 회사는 회원에게 추가 금액을 청구하지
            않습니다.
          </Paragraph>
          <Paragraph>
            ⑥ 회원이 구독 서비스와 별개로 구매한 ‘개별 충전 쿠폰’은 본 조의
            구독 환불 산식에 포함되지 않습니다. 구독 해지 시 잔여 개별 충전
            쿠폰은 자동 환불되지 않으며, 제5조 제2항에 따른 유효기간 동안
            시스템에 보관되나 구독 서비스가 활성화되지 않은 상태에서는 발송
            기능이 제한됩니다.
          </Paragraph>
          <Paragraph>
            ⑦ 제5항의 규정에도 불구하고, 회원의 고의적인 약관 위반, 시스템
            어뷰징, 불법 행위 또는 영업방해 행위가 확인된 경우 회사는 이에 따른
            손해배상을 별도로 청구할 수 있습니다.
          </Paragraph>

          {/* 제4장 */}
          <ChapterTitle>제4장 위치기반서비스 및 권리·의무</ChapterTitle>

          <ConsentBox>
            위치기반서비스(LBS) 이용 및 조르기 데이터 영업 활용에 동의합니다.
            (필수)
          </ConsentBox>

          <ArticleTitle>
            제7조 (위치기반 데이터 수집 및 비가맹점 영업 활용)
          </ArticleTitle>
          <Paragraph>
            ① 회사는 이용자의 위치(GPS)를 기반으로 반경 내 회원의 매장 및 혜택
            정보를 우선 노출합니다. 회사는 관련 법령에 따라 서비스 제공 목적이
            달성된 즉시 해당 위치정보를 지체 없이, 복구 불가능한 방법으로
            영구 파기합니다.
          </Paragraph>
          <Paragraph>
            ② 이용자가 서비스 내에서 비가맹점 매장에 ‘쿠폰 요청하기(조르기)’를
            클릭한 통계 데이터는 철저히 비식별화(익명화) 과정을 거쳐, 해당 매장
            점주에게 서비스 가입 권유, 시장 조사, 영업 목적으로 제공될 수 있으며
            회원은 이에 동의합니다.
          </Paragraph>

          <ArticleTitle>제8조 (표시·광고 관련 책임)</ArticleTitle>
          <Paragraph>
            ① 회원은 서비스 내 할인 쿠폰을 발행함에 있어 「표시·광고의 공정화에
            관한 법률」 및 관련 법령을 준수하여야 하며, 허위·과장된 가격, 부당한
            할인율 표시, 미끼성 광고, 실제 제공하지 않는 혜택 기재 등의 행위를
            하여서는 안 됩니다.
          </Paragraph>
          <Paragraph>
            ② 회원이 등록한 쿠폰 정보의 내용 및 진실성에 대한 책임은 회원에게
            있습니다.
          </Paragraph>
          <Paragraph>
            ③ 회원의 허위·과장된 쿠폰 정보 제공으로 인해 소비자 분쟁, 행정기관
            조사, 과태료 부과 또는 회사에 손해가 발생한 경우, 회원은 회사에
            발생한 손해(조사 대응 비용, 소송 비용, 제3자에 대한 배상금 등을
            포함)를 배상하여야 합니다. 다만, 해당 손해가 회사의 고의 또는
            중과실로 인하여 발생한 경우에는 그러하지 아니합니다.
          </Paragraph>
          <Paragraph>
            ④ 회사는 회원의 법령 위반 또는 소비자 피해 발생이 명백하거나 긴급한
            조치가 필요한 경우, 사전 통지 없이 해당 쿠폰을 일시 중단할 수
            있으며, 사안의 경중에 따라 서비스 이용 제한 또는 계약 해지 조치를
            취할 수 있습니다.
          </Paragraph>

          {/* 제5장 */}
          <ChapterTitle>제5장 특약 및 플랫폼 보호 조항</ChapterTitle>

          <ConsentBox>
            매장 등록 콘텐츠의 앱 내 마케팅 무상 활용에 동의합니다. (선택/권장)
          </ConsentBox>

          <ArticleTitle>
            제9조 (게시물의 저작권 및 마케팅 활용권) — 강화 정리본
          </ArticleTitle>
          <Paragraph>
            ① 회원이 서비스 내에 등록한 매장 사진, 메뉴판, 홍보 문구 등 게시물의
            저작권은 회원에게 귀속됩니다.
          </Paragraph>
          <Paragraph>
            ② 회원은 회사에 대하여 서비스 운영, 홍보, 마케팅, 제휴, 광고 집행 및
            사업 활동을 위하여 해당 게시물을 복제, 전송, 배포, 공중송신, 전시,
            편집, 수정, 2차적 저작물 작성 및 제3자에 대한 재허락을 포함한
            비독점적·무상·전 세계적 사용권을 부여합니다. 이 사용권은 게시 기간
            동안 유효하며, 제5항 단서에 따라 일부 범위에서 존속할 수 있습니다.
          </Paragraph>
          <Paragraph>
            ③ 회사는 제2항의 목적 범위 내에서 게시물을 수정·편집할 수 있으며,
            회원은 해당 범위 내에서 저작인격권(성명표시권, 동일성유지권 등)을
            행사하지 아니합니다.
          </Paragraph>
          <Paragraph>
            ④ 회원은 게시물이 제3자의 저작권, 초상권, 상표권 등 권리를 침해하지
            않음을 보증하며, 이로 인하여 회사에 손해가 발생한 경우 이를
            배상하여야 합니다. 회사는 제3자의 권리 침해 신고가 접수되거나 침해가
            합리적으로 의심되는 경우, 사전 통보 없이 해당 게시물을 임시
            조치(블라인드)하거나 삭제할 수 있습니다.
          </Paragraph>
          <Paragraph>
            ⑤ 회원이 게시물을 삭제하거나 탈퇴하는 경우, 회사는 신규 마케팅
            활용을 중단합니다. 다만, 이미 제작·배포된 홍보물, 집행 중인 광고물
            및 합리적으로 회수가 불가능한 자료에 대해서는 물리적·기술적 회수 및
            삭제 의무를 부담하지 않습니다.
          </Paragraph>

          <ArticleTitle>제10조 (부정 이용 금지 및 조치)</ArticleTitle>
          <Paragraph>
            ① 회원은 다음 각 호의 부정 이용 행위를 하여서는 아니 됩니다.
          </Paragraph>
          <SubItem>가. GPS 위치 변조, 좌표 조작 행위</SubItem>
          <SubItem>나. 매크로·봇 등을 통한 노출·랭킹·클릭수 조작</SubItem>
          <SubItem>다. 기타 서비스 운영을 방해하는 행위</SubItem>
          <Paragraph>
            ② 제1항의 행위가 확인되는 경우 회사는 사전 통보 없이 서비스 이용을
            즉시 제한 또는 영구 정지할 수 있습니다.
          </Paragraph>
          <Paragraph>
            ③ 회원의 부정 이용으로 인하여 회사에 손해가 발생한 경우, 회사는 해당
            손해 범위 내에서 기 결제 요금 및 잔여 쿠폰 상당액을 공제하거나
            별도의 손해배상을 청구할 수 있습니다.
          </Paragraph>
          <Paragraph>
            ④ 제3항의 공제 금액이 실제 손해를 초과하지 않는 범위에서 산정됨을
            원칙으로 합니다.
          </Paragraph>

          <ArticleTitle>제11조 (요금 정책의 변경)</ArticleTitle>
          <Paragraph>
            ① 회사는 서비스 내용, 시장 상황, 비용 구조 변동 등을 사유로 구독
            요금 또는 충전 수량을 변경할 수 있습니다.
          </Paragraph>
          <Paragraph>
            ② 회사는 변경 내용, 적용 시점, 변경 사유 및 해지 방법을 시행일 30일
            전까지 이메일, 앱 푸시(Push) 알림, 알림톡 등 회사가 통상적으로
            사용하는 전자적 통지 수단을 통하여 회원에게 개별적으로 고지합니다.
          </Paragraph>
          <Paragraph>
            ③ 회원이 시행일 전까지 해지 의사를 표시하지 아니하고 자동결제가
            유지되는 경우, 변경된 요금 및 조건에 동의한 것으로 간주합니다.
          </Paragraph>
          <Paragraph>
            ④ 변경이 회원에게 불리한 경우, 회원은 시행일 전까지 해지할 수
            있으며, 시행일 이전까지는 종전 요금이 적용됩니다.
          </Paragraph>

          {/* 제6장 */}
          <ChapterTitle>제6장 책임 제한 (절대 면책 조항)</ChapterTitle>

          <ArticleTitle>
            제12조 (정보 제공 플랫폼으로서의 책임 제한)
          </ArticleTitle>
          <Paragraph>
            ① 회사는 정보 제공 플랫폼으로서 회원과 이용자 간의 쿠폰 거래를 위한
            시스템을 제공할 뿐, 거래의 직접적인 당사자가 아닙니다.
          </Paragraph>
          <Paragraph>
            ② 회원이 발행한 쿠폰의 혜택 이행 거부, 매장 내 서비스 불만족, 허위
            정보 기재 등으로 인하여 발생하는 모든 민·형사상 책임은 전적으로
            회원에게 있습니다.
          </Paragraph>
          <Paragraph>
            ③ 제2항과 관련하여 제3자(이용자, 소비자, 행정기관 등)가 회사에
            대하여 민원, 분쟁조정, 소송, 과태료 부과 또는 기타 법적 절차를
            제기하는 경우, 회원은 자신의 책임과 비용으로 회사를 면책하여야
            하며, 회사가 합리적으로 지출한 방어 비용(변호사 선임비, 소송 비용,
            행정 대응 비용 등)을 배상하여야 합니다.
          </Paragraph>
          <Paragraph>
            ④ 회사는 플랫폼의 신뢰 보호를 위하여 방어 및 합의 과정에 주도적으로
            참여하거나 통제권을 가질 수 있습니다. 다만, 회원이 비용을 부담하여야
            하는 합의를 진행하는 경우에는 사전에 그 내용과 조건을 회원에게
            통지하고 협의하여야 하며, 회원은 합리적인 사유 없이 이를 거절할 수
            없습니다. 회원이 합리적 사유 없이 협의를 거부하거나 지연하는 경우,
            회사는 독자적으로 합의를 진행할 수 있으며, 그에 따른 비용을 회원에게
            청구할 수 있습니다.
          </Paragraph>
          <Paragraph>
            ⑤ 다만, 회사의 고의 또는 중과실로 인하여 발생한 손해에 대해서는
            관련 법령에 따라 책임을 부담합니다.
          </Paragraph>

          <ArticleTitle>제13조 (서비스 점검 및 장애에 대한 책임 제한)</ArticleTitle>
          <Paragraph>
            ① 회사는 정기 점검, 시스템 개선, 보안 패치, 긴급 유지보수 등 서비스
            품질 향상을 위한 작업으로 인하여 서비스가 일시적으로 중단될 수
            있으며, 이는 약관 위반으로 보지 않습니다.
          </Paragraph>
          <Paragraph>
            ② 회사의 귀책사유로 인하여 서비스가 회사의 시스템 로그, 모니터링
            기록 등 객관적인 자료에 근거하여 연속 24시간 이상 전면적으로 중단된
            경우에 한하여, 회사는 중단 시간에 비례하여 구독 기간 연장 등
            합리적인 범위 내의 보상 조치를 취합니다.
          </Paragraph>
          <Paragraph>
            ③ 제2항의 보상은 해당 장애로 인하여 직접적인 영향을 받은 구독 서비스
            범위에 한정되며, 현금 환불은 하지 아니합니다.
          </Paragraph>
          <Paragraph>
            ④ 통신사 네트워크 장애, 천재지변, 정전, 제3자의 불법행위(해킹, DDoS
            등), 정부의 행정조치, 기타 회사의 합리적인 통제를 벗어난 사유로 인한
            서비스 중단에 대하여는 회사는 책임을 부담하지 않습니다.
          </Paragraph>
          <Paragraph>
            ⑤ 회사는 서비스 장애로 인하여 발생한 회원의 일실이익(매출 손실, 기대
            수익 감소 등) 또는 간접 손해에 대하여는 책임을 부담하지 않습니다.
            또한 연속 24시간 미만의 장애 또는 일부 기능 제한에 대하여도 별도의
            보상 의무를 부담하지 아니합니다. 다만, 회사의 고의 또는 중과실이
            있는 경우에는 관련 법령에 따라 책임을 질 수 있습니다.
          </Paragraph>

          <p className="mt-8 pt-4 border-t text-[11px] text-muted-foreground text-center">
            본 약관은 마이쿠폰 가맹점 회원에게 적용되며, 일반 이용자(소비자)
            서비스 이용약관과는 별도로 운영됩니다.
          </p>

          {/* ── PART 2. 사업주 전용 회원가입 수집·이용 동의 ───────── */}
          <div className="rounded-lg bg-primary/5 border border-primary/20 px-3 py-2 mt-10 mb-4">
            <p className="text-[11px] font-bold text-primary/80 tracking-widest">
              PART 2
            </p>
            <p className="text-sm font-bold text-foreground">
              사업주 전용 회원가입 수집·이용 동의
            </p>
          </div>

          <ConsentBox>
            가맹점 계약 체결 및 서비스 운영을 위한 개인(사업자)정보 수집·이용에
            동의합니다. (필수)
          </ConsentBox>

          <Paragraph>
            회사는 가맹점 서비스 운영, 요금제 안내, 쿠폰 발송권 제안, 통계 분석
            리포트 제공, 맞춤형 비즈니스 제안, 계약 관리 및 고객 지원을 위하여
            가맹점 정보를 수집·이용할 수 있습니다.
          </Paragraph>

          <ArticleTitle>수집·이용 목적</ArticleTitle>
          <SubItem>· 구독 요금제 및 상품 안내</SubItem>
          <SubItem>· 추가 쿠폰 발송권 제안</SubItem>
          <SubItem>· 이용 데이터 기반 통계 리포트 제공</SubItem>
          <SubItem>· 상권 분석 및 맞춤형 영업 지원</SubItem>
          <SubItem>· 계약 관리 및 운영 지원</SubItem>

          <ArticleTitle>수집 항목</ArticleTitle>
          <Paragraph>
            상호명, 대표자명, 연락처, 이메일, 사업자등록번호, 서비스 이용 기록
          </Paragraph>

          <ArticleTitle>보유 기간</ArticleTitle>
          <Paragraph>계약 종료 후 관련 법령에 따른 보존 기간까지</Paragraph>

          <p className="mt-3 text-[12px] text-muted-foreground">
            ※ 본 동의는 가맹점 계약 체결 및 서비스 운영을 위한 필수 동의
            사항입니다.
          </p>

          <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 my-4">
            <p className="text-[11px] font-bold text-gray-600 mb-1.5 tracking-wide">
              ┗ [선택] 광고성 정보 수신 동의
            </p>
            <Paragraph>
              회사는 이벤트, 프로모션, 제휴 서비스 안내 등을 문자, 이메일, 푸시,
              전화 등을 통해 제공할 수 있습니다.
            </Paragraph>
            <SubItem>· 수신 매체: SMS, 알림톡, 이메일, 푸시, TM</SubItem>
            <SubItem>· 보유 기간: 철회 시까지</SubItem>
            <p className="text-[12px] text-muted-foreground mt-2">
              거부하여도 서비스 이용에는 제한이 없습니다.
            </p>
          </div>

          {/* ── PART 3. 마케팅 수집·이용 및 광고성 정보 수신 동의 ─── */}
          <div className="rounded-lg bg-primary/5 border border-primary/20 px-3 py-2 mt-10 mb-4">
            <p className="text-[11px] font-bold text-primary/80 tracking-widest">
              PART 3
            </p>
            <p className="text-sm font-bold text-foreground">
              마케팅 목적의 수집·이용 및 광고성 정보 수신 동의 (선택)
            </p>
          </div>

          <Paragraph>
            회사는 회원(가맹점 및 이용자)에게 더 나은 맞춤형 서비스와 비즈니스
            혜택을 제공하기 위하여, 아래와 같이 개인정보를 수집 및 이용하며
            광고성 정보를 전송합니다.
          </Paragraph>

          <ArticleTitle>1. 수집 및 이용 목적</ArticleTitle>
          <SubItem>
            · 신규 서비스(요금제) 출시 안내, 맞춤형 혜택 제공 및 이벤트 행사 안내
          </SubItem>
          <SubItem>
            · 회사가 운영하는 타 서비스 및 패밀리 브랜드(광고·비즈니스 솔루션
            등)의 상품 안내 및 교차 마케팅
          </SubItem>
          <SubItem>
            · 회사의 내부 마케팅팀/영업팀을 통한 가맹점 영업 컨택 (텔레마케팅 등
            전화 안내 포함)
          </SubItem>
          <SubItem>· 서비스 이용 통계 분석 및 맞춤형 광고 서비스 제공</SubItem>

          <ArticleTitle>2. 수집하는 항목</ArticleTitle>
          <Paragraph>
            상호명, 대표자명, 휴대전화 번호, 이메일 주소, 서비스 이용 기록
          </Paragraph>

          <ArticleTitle>3. 광고성 정보 수신 매체</ArticleTitle>
          <Paragraph>
            휴대전화 문자메시지(SMS/MMS), 카카오 알림톡, 이메일, 앱 내
            푸시(Push) 알림, 음성 통화(TM)
          </Paragraph>

          <ArticleTitle>4. 보유 및 이용 기간</ArticleTitle>
          <Paragraph>
            회원 탈퇴 시 또는 마케팅 수신 동의 철회 시까지
          </Paragraph>

          <Callout>
            귀하는 본 동의를 거부할 권리가 있으며, 거부하시더라도 마이쿠폰의
            기본 가맹점 서비스는 정상적으로 이용하실 수 있습니다. 단, 거부 시
            특가 프로모션 안내 및 부가 영업 지원 혜택을 받지 못할 수 있습니다.
          </Callout>

          <p className="mt-8 pt-4 border-t text-[11px] text-muted-foreground text-center">
            본 약관 및 동의서는 마이쿠폰 사업주(가맹점) 회원에게 적용되며, 필수
            동의 항목과 선택 동의 항목을 구분하여 안내드립니다.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
