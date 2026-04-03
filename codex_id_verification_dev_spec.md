# Codex용 신분증 OCR + 영문화 + 이름 일치 검증 웹앱 상세 개발 지시서

## 0. 프로젝트 목표

다음 요구사항을 만족하는 **신분증 OCR + 영문화 + 이름 일치 검증 웹앱**을 구현하라.

사용자 흐름:
- 사용자가 영문 이름을 입력한다.
- 신분증 사진을 업로드한다.
- 검증 버튼을 누른다.
- 서버가 OpenAI API를 호출한다.
- 신분증에서 로컬 언어 이름을 OCR로 추출한다.
- 추출된 로컬 이름을 영문화한다.
- 사용자가 입력한 영문 이름과 OCR 후 영문화한 이름을 비교한다.
- 생년월일, 출생지, 국적, 성별 등 필드를 추출한다.
- 각 필드별 confidence와 문서 품질 confidence를 반환한다.
- 결과를 색상 기반 UI로 표시한다.

이 프로젝트는 GitHub 저장소에 올리고 Vercel에 배포할 수 있어야 한다.

중요 보안 원칙:
- OpenAI API 키는 절대 프런트엔드에 넣지 말 것
- 브라우저에서 OpenAI를 직접 호출하지 말 것
- 반드시 서버 API 또는 Vercel Serverless Function에서만 호출할 것
- 실제 키는 `.env.local` 또는 Vercel Environment Variables에만 저장할 것

---

## 1. 기술 스택

다음 스택으로 구현하라.

- Next.js 최신 App Router 기반
- TypeScript
- Tailwind CSS
- Vercel 배포 가능 구조
- OpenAI 공식 Node SDK 사용
- 서버 API는 `app/api/.../route.ts` 방식 사용
- 이미지 업로드는 브라우저에서 파일 선택 후 서버로 전달
- 결과 UI는 카드형 + 색상 배지 형태로 구현

---

## 2. 반드시 지켜야 할 핵심 요구사항

### 2-1. 가장 중요한 핵심
이 프로젝트의 핵심은 **사용자가 입력한 영문 이름과 OCR로 추출한 로컬 이름을 AI가 영문화한 결과를 비교하는 로직**이다.

즉 단순 OCR 앱이 아니라 아래를 정확히 구현해야 한다.

1. 신분증에서 로컬 이름 추출
2. 로컬 이름을 영문화
3. 사용자가 입력한 영문 이름을 정규화
4. AI가 영문화한 이름도 정규화
5. 양쪽을 비교
6. 비교 결과를 다음 중 하나로 판정
   - `exact_match`
   - `likely_match`
   - `possible_match`
   - `mismatch`
   - `manual_review`
7. 이름 비교 결과에 대한 별도 confidence와 reason을 반드시 반환

### 2-2. 비교 시 반드시 처리할 항목
비교 로직은 다음 차이를 흡수할 수 있어야 한다.

- 대소문자 차이
- 하이픈 차이
- 공백 차이
- 중간 공백 여러 개
- 성/이름 순서 차이 일부
- middle name 생략
- 로마자 표기 여러 후보
- surname / given name 분리 실패 가능성
- 한국어/일본어/중국어/아랍어/키릴 문자 등에서 발생 가능한 복수 영문화 후보

예:
- `Giljung Kim`
- `Gil-jung Kim`
- `Kim Giljung`
- `Kim Gil-jung`

이런 차이는 단순 mismatch가 아니라, 규칙 기반 보정 후 AI 판단을 추가하여 `likely_match` 또는 `possible_match`로 처리하라.

---

## 3. 입력 UI 요구사항

페이지 상단에 제목과 설명을 보여라.

필수 입력 필드:
- `User Entered English Full Name`
- `ID Image Upload`

선택 입력 필드:
- `Country hint`
- `Document type hint`

버튼:
- `Validate`

추가 UX:
- 이미지 미리보기
- 로딩 상태 표시
- 에러 메시지 표시
- 결과가 나오면 자동 스크롤

---

## 4. 출력 UI 요구사항

결과 화면에는 아래 항목을 반드시 표 형태 또는 카드 형태로 출력하라.

### 4-1. 추출 필드
- First name
- Local_First name
- Last name
- Local_Last name
- Middle name
- Local_Middle name
- Gender
- Date of birth
- Place of birth
- Nationality

### 4-2. 추가 필드
- Name match result
- Name match reason
- Document quality confidence
- Overall extraction confidence
- Image quality notes
- Country detected
- Document type guessed

### 4-3. 각 필드별 confidence
아래 각 항목마다 별도 confidence를 보여라.

- `first_name_confidence`
- `local_first_name_confidence`
- `last_name_confidence`
- `local_last_name_confidence`
- `middle_name_confidence`
- `local_middle_name_confidence`
- `gender_confidence`
- `date_of_birth_confidence`
- `place_of_birth_confidence`
- `nationality_confidence`
- `document_quality_confidence`
- `name_match_confidence`
- `overall_confidence`

### 4-4. 색상 규칙
confidence 점수에 따라 다음 색을 적용하라.

- `0.00 ~ 0.49`: 빨강
- `0.50 ~ 0.79`: 노랑
- `0.80 ~ 1.00`: 초록

배지 텍스트 예시:
- `Low`
- `Review`
- `Good`

### 4-5. 이름 비교 결과 색상
- `exact_match`: 초록
- `likely_match`: 초록
- `possible_match`: 노랑
- `manual_review`: 노랑
- `mismatch`: 빨강

---

## 5. 반드시 구현해야 하는 서버 아키텍처

프런트엔드는 OpenAI를 직접 호출하면 안 된다.
반드시 서버 라우트에서 OpenAI를 호출하라.

구현 구조:

- `app/page.tsx`
  - 폼 UI
  - 이미지 업로드
  - 결과 표시

- `app/api/verify-id/route.ts`
  - POST 요청 수신
  - 파일 검증
  - OpenAI 호출
  - 응답 파싱
  - 정규화/비교 로직 수행
  - 최종 JSON 반환

- `lib/openai.ts`
  - OpenAI 클라이언트 생성

- `lib/name-normalizer.ts`
  - 이름 정규화 함수

- `lib/name-matcher.ts`
  - 영문화 이름 비교 함수

- `lib/confidence.ts`
  - confidence 색상/등급 매핑

- `lib/gender-extraction.ts`
  - 성별 추출 보조 로직

- `types/verification.ts`
  - 응답 타입 정의

---

## 6. OpenAI 호출 방식

OpenAI **Responses API**를 사용하라.
응답은 가능한 한 **구조화된 JSON**으로 강제하라.

### 6-1. 모델 사용 원칙
- 이미지 이해 가능한 최신 범용 모델 사용
- 응답은 반드시 JSON 스키마 기반
- 자유문장 응답 금지
- 온도는 낮게 설정하여 일관성 우선
- extraction consistency 우선

### 6-2. 모델에게 시킬 일
모델은 다음을 수행해야 한다.

1. 이미지 품질 평가
2. 국가 추정
3. 문서 종류 추정
4. 이름 원문 추출
5. 이름 분해
   - local first
   - local middle
   - local last
6. 이름 영문화
   - primary romanization
   - alternative romanizations
7. 성별 추출
8. DOB 추출
9. Place of birth 추출
10. Nationality 추출
11. 각 필드 confidence 추정
12. 필드가 불명확하면 빈 문자열 반환
13. OCR이 불확실하면 notes에 이유 남김

---

## 7. OpenAI에 전달할 시스템 지시사항

서버에서 OpenAI 호출 시 아래 목적을 충실히 반영한 프롬프트를 작성하라.

### 시스템 프롬프트 요구사항
- 당신은 신분증 문서 분석기다.
- 입력은 사용자가 제공한 영문 이름과 신분증 이미지다.
- 출력은 오직 JSON이어야 한다.
- 보이지 않는 값은 추측하지 말고 빈 문자열로 반환하라.
- 이름은 로컬 원문과 영문화 결과를 분리해서 반환하라.
- OCR 확실성이 낮으면 confidence를 낮춰라.
- 문서 품질이 낮으면 `document_quality_confidence`를 낮춰라.
- 영문화는 단일 결과만 내지 말고 대안 표기도 배열로 반환하라.
- 이름 순서가 불명확하면 notes에 설명하라.
- 성별은 문서에 직접 있거나 OCR로 라벨+값이 확인될 때만 반환하라.
- 얼굴, 이름, 번호 규칙만으로 성별을 추정하지 말라.
- 불확실한 추정은 반드시 낮은 confidence 또는 빈 문자열로 처리하라.

---

## 8. Structured Output JSON 스키마 요구사항

응답 JSON에는 최소한 아래 필드를 포함하라.

- `user_input_english_name`
- `country_detected`
- `document_type_detected`
- `document_quality_confidence`
- `document_quality_notes`

- `first_name`
- `local_first_name`
- `first_name_confidence`
- `local_first_name_confidence`

- `last_name`
- `local_last_name`
- `last_name_confidence`
- `local_last_name_confidence`

- `middle_name`
- `local_middle_name`
- `middle_name_confidence`
- `local_middle_name_confidence`

- `gender`
- `gender_confidence`
- `gender_source`
- `gender_evidence`
- `gender_notes`

- `date_of_birth`
- `date_of_birth_confidence`

- `place_of_birth`
- `place_of_birth_confidence`

- `nationality`
- `nationality_confidence`

- `romanization_primary_full_name`
- `romanization_alternatives`
- `romanization_notes`

- `name_match_result`
- `name_match_confidence`
- `name_match_reason`

- `overall_confidence`
- `manual_review_required`
- `warnings`

모든 문자열 필드는 값이 없으면 `""` 로 반환하고, 배열은 없으면 빈 배열로 반환하라.

---

## 9. 이름 비교 로직 상세 요구사항

이 부분이 가장 중요하다.

### 9-1. 비교는 AI 응답만 믿지 말고 코드 후처리도 하라
서버에서 다음 순서로 이름 비교를 수행하라.

1. 사용자 입력 영문 이름 정규화
2. `romanization_primary_full_name` 정규화
3. `romanization_alternatives` 각각 정규화
4. exact string match 검사
5. token set match 검사
6. surname-first order swap 검사
7. hyphen 제거 후 검사
8. middle name 생략 허용 검사
9. 유사도 점수 계산
10. AI가 반환한 notes와 OCR confidence를 함께 반영해 최종 판정

### 9-2. 정규화 규칙
정규화 함수는 아래를 수행하라.

- 소문자 변환
- 악센트 제거 가능하면 제거
- 하이픈 제거 또는 공백 치환
- 쉼표 제거
- 마침표 제거
- 연속 공백 축소
- trim
- 비문자 구분자 제거
- 토큰 분리 후 재조합

예:
- `Kim, Gil-Jung`
- `kim gil jung`
- `KIM GILJUNG`
를 같은 계열로 비교할 수 있어야 한다.

### 9-3. 유사도 판정 가이드
예시 규칙:

- `exact_match`
  - primary 또는 alternative 중 하나가 정규화 후 완전일치
- `likely_match`
  - 토큰 일치 + 하이픈/순서 차이만 존재
- `possible_match`
  - 일부 토큰만 일치하거나 middle name 누락
- `mismatch`
  - 성/이름 핵심 토큰이 크게 다름
- `manual_review`
  - OCR confidence가 낮거나 이름 분해가 애매함

### 9-4. 반드시 반환할 설명
`name_match_reason`에는 반드시 사람이 읽을 수 있는 설명을 넣어라.

예:
- `User input matches the primary romanized full name after normalization.`
- `Match found only after surname/given-name order swap.`
- `Middle name missing in input, but first and last names are aligned.`
- `OCR is weak and romanization is uncertain; manual review recommended.`
- `The surname differs materially from the extracted name.`

---

## 10. 성별 추출 요구사항

이번 프로젝트에서는 **번호 규칙 기반 성별 추정이 아니라, 신분증에서 실제로 읽을 수 있는 성별 표기만 사용**한다.

### 10-1. 공통 정책
성별은 아래 우선순위로만 추출하라.

1. **문서에 직접 인쇄된 성별 필드**
   - 예: `Sex`, `Gender`, `Sexo`, `性别`, `性別`, `Jenis Kelamin`, `Jantina`
2. **문서 OCR에서 성별 필드 라벨과 값이 함께 식별되는 경우**
3. **공식 자료로 해당 ID에 성별 demographic field가 존재함이 확인된 국가에 한해, 로컬 라벨 후보를 추가 탐색**
4. 위 조건을 만족하지 못하면 성별은 빈 문자열로 반환

### 10-2. 절대 금지
- 얼굴 이미지 기반 성별 추정 금지
- 이름만 보고 성별 추정 금지
- 공식 근거 없이 주민번호/ID번호/시리얼 규칙으로 성별 추정 금지
- 확신이 낮은 경우 억지 반환 금지

### 10-3. 출력 정책
- `gender`: `"Male" | "Female" | "X" | ""`
- `gender_confidence`: `0.0 ~ 1.0`
- `gender_source`: `"printed_field" | "ocr_field" | "country_label_mapping" | "unknown"`
- `gender_evidence`: OCR로 잡힌 라벨/값 원문
- `gender_notes`: 불확실한 이유 설명

---

## 11. 1차 지원 국가와 성별 식별 단서

아래 국가는 **번호 규칙이 아니라, 문서 표면의 성별 라벨/값 OCR**을 기준으로 지원하라.

### 대한민국 (KR)
사용 가능한 단서:
- 카드 표면에서 `성별`, `SEX`, `Sex`, `Gender`, `M`, `F` 같은 직접 표기

구현 지시:
- 한국은 번호 규칙을 쓰지 말고, 직접 인쇄된 성별 필드가 있는 경우만 사용
- 카드 종류가 다양하므로 OCR 근거가 분명할 때만 채택

### 중국 (CN)
사용 가능한 단서:
- `性别`, `性別`, `Sex`
- 값 후보: `男`, `女`

구현 지시:
- `男` -> `Male`
- `女` -> `Female`
- 라벨과 값이 같이 잡히면 높은 confidence
- 라벨 없이 값만 단독으로 보이면 confidence 낮춤

### 일본 (JP)
사용 가능한 단서:
- `性別`, `Sex`, `Gender`

구현 지시:
- OCR에 `性別` 또는 `Sex` 라벨이 명확히 보일 때만 사용
- 아니면 빈 문자열

### 필리핀 (PH)
사용 가능한 단서:
- `Sex`, `SEX`
- 값 후보: `Male`, `Female`, `M`, `F`

구현 지시:
- 라벨과 값이 같이 확인되면 사용
- 번호 기반 규칙은 사용 금지

### 인도네시아 (ID)
사용 가능한 단서:
- `Jenis Kelamin`, `Kelamin`, `Sex`
- 값 후보: `Laki-Laki`, `Pria`, `L`, `Perempuan`, `Wanita`, `P`

구현 지시:
- 라벨 기반 OCR 결과가 명확할 때만 사용
- `Laki-Laki`, `Pria`, `L` -> `Male`
- `Perempuan`, `Wanita`, `P` -> `Female`
- 번호 규칙 금지

### 말레이시아 (MY)
사용 가능한 단서:
- `Jantina`, `Gender`, `Sex`
- 값 후보: `Lelaki`, `Male`, `M`, `Perempuan`, `Female`, `F`

구현 지시:
- 직접 라벨과 값이 보일 때만 사용
- 휴리스틱 최소화

### 캄보디아 (KH)
사용 가능한 단서:
- `Sex`, `Gender`

구현 지시:
- 로컬 라벨은 추후 확장 가능 구조로 둔다
- 직접 라벨+값이 없으면 반환 금지

### 인도 (IN)
사용 가능한 단서:
- `Gender`, `GENDER`, `लिंग`
- 값 후보: `Male`, `Female`, `M`, `F`, `Transgender`, `T`, `Other`

구현 지시:
- 실제 카드/문서 OCR에서 직접 확인된 값만 사용
- `Transgender`, `T`, `Other` -> 필요 시 `X`
- 번호 규칙 금지

### UAE (AE)
사용 가능한 단서:
- `Sex`, `Gender`
- 값 후보: `Male`, `Female`, `M`, `F`

구현 지시:
- 직접 라벨이 없으면 빈 문자열

### 아르헨티나 (AR)
사용 가능한 단서:
- `Sexo`, `Sex`
- 값 후보: `M`, `F`, `X`

구현 지시:
- `M` -> `Male`
- `F` -> `Female`
- `X` -> `X`
- `X` 값을 정상값으로 처리할 것

### 브라질 (BR)
사용 가능한 단서:
- `Sexo`, `Sex`
- 값 후보: `M`, `Masculino`, `F`, `Feminino`, 필요 시 `X`

구현 지시:
- 직접 라벨+값이 없으면 빈 문자열

### 나이지리아 (NG)
사용 가능한 단서:
- `Sex`, `Gender`
- 값 후보: `Male`, `Female`, `M`, `F`

구현 지시:
- 직접 라벨이 보이지 않으면 반환 금지

---

## 12. 성별 라벨/값 매핑용 예시 코드 요구사항

Codex는 아래와 같은 구조의 매핑 테이블을 구현하라.

```ts
export const GENDER_LABEL_HINTS: Record<string, string[]> = {
  KR: ["성별", "SEX", "Sex", "Gender"],
  CN: ["性别", "性別", "Sex"],
  JP: ["性別", "Sex", "Gender"],
  PH: ["Sex", "SEX"],
  ID: ["Jenis Kelamin", "Kelamin", "Sex"],
  MY: ["Jantina", "Gender", "Sex"],
  KH: ["Sex", "Gender"],
  IN: ["Gender", "GENDER", "लिंग"],
  AE: ["Sex", "Gender"],
  AR: ["Sexo", "Sex"],
  BR: ["Sexo", "Sex"],
  NG: ["Sex", "Gender"],
};
```

```ts
export const GENDER_VALUE_MAP: Record<string, "Male" | "Female" | "X"> = {
  male: "Male",
  m: "Male",
  남: "Male",
  男: "Male",
  lelaki: "Male",
  "laki-laki": "Male",
  pria: "Male",
  masculino: "Male",

  female: "Female",
  f: "Female",
  여: "Female",
  女: "Female",
  perempuan: "Female",
  wanita: "Female",
  feminino: "Female",

  x: "X",
  other: "X",
  transgender: "X",
  t: "X",
};
```

### 성별 구현 규칙 코드 블록

```ts
// Gender extraction policy
// 1) Never infer gender from face.
// 2) Never infer gender from name only.
// 3) Never infer gender from document number.
// 4) Prefer explicitly printed gender/sex field on the document.
// 5) Use OCR label + value evidence only.
// 6) If unclear, return:
//    gender=""
//    gender_confidence=low
//    manual_review_required=true
```

---

## 13. 날짜 처리 규칙

### Date of birth
- 반드시 `YYYY-MM-DD` 형식으로 반환
- 일/월이 확실하지 않으면 빈 문자열 또는 낮은 confidence
- 여러 형식이 보이면 표준화 후 반환

### Place of birth
- 문자열 필드로 구현
- 날짜 형식으로 처리하지 말 것
- 값이 없으면 빈 문자열

---

## 14. 이미지 품질 평가 규칙

OpenAI 응답과 별도로 서버도 최소한의 기초 검사 가능하게 하라.

이미지 품질 평가 기준:
- 해상도 너무 낮음
- 문서가 프레임 밖으로 잘림
- 반사광 심함
- 초점 흐림
- 문서가 크게 기울어짐
- 손가락/가림 존재
- 텍스트 영역 일부 손실

`document_quality_confidence`를 0~1로 반환하고,
`document_quality_notes`에 원인을 넣어라.

---

## 15. UI 표현 규칙

결과를 한눈에 판단할 수 있게 만들어라.

### 카드 구역
1. 업로드/입력 영역
2. 이름 매칭 결과 요약 카드
3. 문서 품질 카드
4. 상세 추출 결과 테이블
5. 경고/수동검수 안내

### 이름 매칭 요약 카드
가장 위에 크게 보여라.
포함:
- User input name
- OCR/AI romanized primary name
- Alternatives
- Match result
- Match confidence
- Reason

이 카드가 앱의 핵심이다.

### 상세 결과 행 예시
각 행에:
- 필드명
- 값
- confidence 숫자
- 색상 배지

---

## 16. 에러 처리 요구사항

다음 경우를 처리하라.

- 이미지 미업로드
- 지원되지 않는 파일 형식
- 파일 너무 큼
- OpenAI 응답 실패
- JSON 파싱 실패
- 필수 필드 누락
- 이미지가 너무 흐림
- 문서를 신분증으로 인식 못함

사용자에게는 너무 기술적인 에러 대신 이해 가능한 문장으로 보여라.

예:
- `이미지를 읽을 수 없습니다. 더 선명한 사진을 업로드해주세요.`
- `신분증 형식을 명확히 인식하지 못했습니다.`
- `이름 비교를 확정할 수 없어 검토가 필요합니다.`

---

## 17. 보안 요구사항

반드시 다음을 지켜라.

- OpenAI API 키는 절대 클라이언트에 넣지 말 것
- `.env.local` 또는 Vercel Environment Variables 사용
- 서버 라우트에서만 OpenAI 호출
- 업로드 파일 타입 검증
- 업로드 파일 크기 제한
- 기본 rate limit 고려
- 민감한 OCR 결과를 콘솔에 과도하게 남기지 말 것
- 노출된 이전 API 키는 즉시 폐기하고 새 키를 사용할 것

---

## 18. GitHub 및 Vercel 배포 요구사항

프로젝트는 GitHub 저장소에 올릴 수 있어야 하고, Vercel에서 배포 가능해야 한다.

Codex는 아래 항목도 함께 준비하라.

- `README.md`
- 로컬 실행 방법
- 환경 변수 예시
- Vercel 배포 방법
- GitHub 업로드 방법
- `.gitignore`
- `.env.example`

환경 변수 예시에는:
- `OPENAI_API_KEY=`
만 넣고 실제 값은 절대 포함하지 말 것

---

## 19. 반드시 포함할 README 내용

README에는 아래를 포함하라.

- 프로젝트 소개
- 기능 설명
- 로컬 실행 방법
- 환경 변수 설정 방법
- Vercel 배포 방법
- 한계 사항

한계 사항 예시:
- 모든 국가의 모든 신분증을 완벽하게 지원하지 않음
- 영문화는 복수 후보가 가능함
- OCR 품질이 낮으면 수동 검토 필요
- 성별은 문서에 직접 보이는 표기를 우선 사용하며, 직접 증거가 없으면 반환하지 않음

---

## 20. 구현 우선순위

아래 순서로 구현하라.

### Phase 1
- 업로드 UI
- OpenAI 이미지 분석
- JSON 추출
- 결과 화면 표시

### Phase 2
- 이름 정규화
- 영문화 이름 비교
- `exact_match / likely_match / possible_match / mismatch / manual_review` 판정

### Phase 3
- confidence 색상 UI
- 문서 품질 카드
- 경고 메시지

### Phase 4
- 국가별 성별 라벨 힌트 적용
- 확장 가능한 성별 추출 모듈화

### Phase 5
- README 정리
- 배포 준비
- Vercel 검증

---

## 21. Codex가 실제로 만들어야 하는 산출물

Codex는 설명만 하지 말고, 바로 실행 가능한 프로젝트를 생성하라.

필수 산출물:
- Next.js 프로젝트 전체 코드
- 타입 정의
- 서버 API 코드
- OpenAI 호출 코드
- 이름 비교 로직
- UI 컴포넌트
- README
- `.env.example`

---

## 22. 절대 하지 말아야 할 것

- API 키를 프런트엔드 코드에 넣지 말 것
- 브라우저에서 OpenAI 직접 호출하지 말 것
- 이름 비교를 단순 문자열 완전일치만으로 끝내지 말 것
- 불확실한 값을 확정처럼 보여주지 말 것
- 성별을 얼굴/이름/번호로 추정하지 말 것
- Place of birth를 날짜로 처리하지 말 것

---

## 23. Codex에게 주는 최종 실행 지시

이제 위 요구사항을 충족하는 **실행 가능한 Next.js + TypeScript + Tailwind 프로젝트 전체 코드**를 작성하라.

구현 시 특히 다음을 최우선으로 하라.

1. **사용자 입력 영문 이름 vs OCR 후 영문화 이름 비교 정확도**
2. **각 필드별 confidence 표시**
3. **사진 품질 confidence 표시**
4. **OpenAI API 키 서버 보안**
5. **Vercel 배포 가능 구조**

또한 결과 UI에서 가장 먼저 보여야 하는 것은 **이름 매칭 결과 요약 카드**다.
이 프로젝트의 본질은 단순 OCR이 아니라 **이름 일치 검증**이다.
