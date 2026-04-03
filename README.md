# KYC ID Name Match Verification

신분증 이미지에서 이름과 주요 필드를 추출하고, OCR 후 영문화한 이름을 사용자가 입력한 영문 이름과 비교하는 Next.js 웹앱입니다.

핵심 포인트는 단순 OCR이 아니라 아래 흐름입니다.

- 신분증 이미지 분석
- 로컬 스크립트 이름 추출
- 영문화 1차 후보 + 대체 후보 생성
- 사용자 입력 영문 이름과 규칙 기반 후처리 비교
- `exact_match`, `likely_match`, `possible_match`, `mismatch`, `manual_review` 판정
- 필드별 confidence, 문서 품질 confidence, 경고 메시지 표시

## Stack

- Next.js App Router
- TypeScript
- Tailwind CSS
- OpenAI Node SDK
- OpenAI Responses API
- Zod structured output

## Features

- 서버 라우트에서만 OpenAI 호출
- 이름 정규화 및 후처리 매칭 로직
- 성별 필드 직접 증거 기반 검증
- 최소한의 로컬 이미지 품질 점검
- 결과 요약 카드 + 상세 confidence 테이블
- 기본 rate limit, 파일 타입 검사, 파일 크기 제한

## Project Structure

- `app/page.tsx`
  메인 입력 폼, 이미지 미리보기, 결과 렌더링
- `app/api/verify-id/route.ts`
  업로드 처리, rate limit, 서버 검증 API
- `lib/openai.ts`
  OpenAI 클라이언트 및 모델 후보 관리
- `lib/openai-schema.ts`
  structured output 스키마
- `lib/name-normalizer.ts`
  이름 정규화
- `lib/name-matcher.ts`
  이름 비교 및 판정
- `lib/gender-extraction.ts`
  국가별 라벨 힌트 기반 성별 검증
- `lib/image-quality.ts`
  로컬 이미지 품질 점검
- `lib/verification.ts`
  OpenAI 호출 + 후처리 통합 서비스
- `types/verification.ts`
  응답 타입 정의

## Local Run

```bash
npm install
npm run dev
```

브라우저에서 `http://localhost:3000` 을 열면 됩니다.

## Environment Variables

프로젝트 루트에 `.env.local` 파일을 두고 실제 키를 넣습니다.

```env
OPENAI_API_KEY=your_real_key_here
```

커밋용 예시는 `.env.example` 에 들어 있습니다.

주의:

- 실제 키는 GitHub에 올리면 안 됩니다.
- 브라우저 코드에 키를 넣으면 안 됩니다.
- 현재 구현은 서버 라우트에서만 OpenAI를 호출합니다.

추가로 특정 모델을 강제로 쓰고 싶다면 `.env.local` 에 `OPENAI_MODEL=` 을 직접 추가할 수 있습니다. 지정하지 않으면 코드가 `gpt-5.4-mini` 를 먼저 시도하고, 계정 접근이 없으면 `gpt-4.1-mini` 로 내려갑니다.

## Vercel Deploy

1. GitHub에 이 저장소를 push 합니다.
2. Vercel에서 해당 저장소를 import 합니다.
3. Vercel 프로젝트 환경 변수에 `OPENAI_API_KEY` 를 추가합니다.
4. 배포를 실행합니다.

이 프로젝트는 App Router 기준이라 별도 서버 코드 분리 없이 Vercel Serverless 환경에서 동작할 수 있습니다.

## GitHub Upload

이미 이 폴더에는 Git 원격 저장소가 연결되어 있습니다.

```bash
git add .
git commit -m "Build KYC ID verification app"
git push -u origin main
```

로컬에서 GitHub 인증이 되어 있지 않으면 push 시 로그인 또는 토큰 입력이 필요할 수 있습니다.

## Security Notes

- OpenAI API 키는 `.env.local` 또는 Vercel Environment Variables 에만 저장합니다.
- 민감한 OCR 결과를 서버 로그에 과도하게 남기지 않도록 구현했습니다.
- 업로드 파일 타입과 파일 크기를 서버에서 다시 검사합니다.
- 메모리 기반 기본 rate limit 을 포함합니다.

## Limits

- 모든 국가의 모든 신분증 형식을 완벽하게 지원하지는 않습니다.
- 영문화는 복수 후보가 가능하므로 항상 수동 검토가 필요할 수 있습니다.
- 이미지가 흐리거나 잘렸다면 OCR 결과가 불안정할 수 있습니다.
- 성별은 문서에 직접 보이는 라벨과 값이 없으면 반환하지 않도록 설계했습니다.
- 로컬 이미지 품질 검사는 해상도와 프레이밍 위주이며, 실제 OCR 난이도 전체를 완전히 대체하지는 않습니다.

## Verification

아래 명령으로 확인했습니다.

```bash
npm run typecheck
npm run lint
npm run build
```
