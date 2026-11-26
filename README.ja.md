# GH Mobile+

スマートフォンのための、非公式・無料・オープンソースのGitHubクライアントです。PWA(Progressive Web App)として動作します。

> GH Mobile+ はGitHub, Inc.とは無関係で、同社の承認を受けたものではありません。

## 概要

スマートフォンで差分をレビューしたり、通知を確認したり、リポジトリを探したりできます。ブラウザからインストールでき、セッション情報とオフライン用データは端末に保存されます。

## 機能

- **ホーム**:「自分」にはコントリビューションカレンダー、自分のタスクの件数、最近プッシュしたリポジトリ2件を表示します。タスクのカードから該当の一覧に移動できます。「フォロー中」はアクティビティとリリースを分けて表示し、自分宛ての通知へのリンクもあります。左上のアバターをタップするか、画面の左端付近から右にスワイプするとメニューが開きます。
- **アカウント**:プロフィールの編集と共有、ソーシャルリンクの追加と削除、リポジトリ・フォロワー・フォロー中の一覧表示ができます。設定とアカウント切り替えは画面上部にあります。編集を有効にすると、GitHub がプロフィールの書き込み権限の許可を求めます。
- **リポジトリ管理**:個人リポジトリの作成とフォークができます。リポジトリの管理者は説明、Web サイト、Issues・Wiki・Projects の有効化、PR のマージ設定を変更できます。
- **リポジトリと検索**:リポジトリタブから自分のリポジトリを開くことができます。検索タブでは対象を選び、検索条件を指定して GitHub 全体を検索できます。
- **タスク**:レビュー依頼、作成したオープンな PR、担当している Issue と PR、失敗した CI を確認できます。
- **通知**:ホーム右上のベルから開きます。一覧でスレッドを読んだり、個別に既読にしたり、複数選んでまとめて操作したりできます。
- **コードレビュー**:ファイルの確認済みマーク、ハンク単位の移動、行・範囲へのコメント、変更提案(suggestion)、レビューの送信ができます。
- **PR・Issue**:タイムライン、プレビューと補完付きの入力欄、ラベル、担当者、マージに対応しています。同一リポジトリのブランチを比較して通常の PR やドラフト PR を作成できます。PRの状態は一覧・検索・詳細で共通のアイコンと色で表示します。
- **コード**:シンタックスハイライト付きでコードを閲覧できます。既存のブランチでテキストファイルを作成・編集し、直接コミットするか、ブランチ・フォーク経由でPRを作成できます。
- **Actions**:実行一覧、ジョブ、ログ、再実行、キャンセル、inputs付きのworkflow_dispatchに対応しています。
- 複数アカウント、任意のアプリロック、読み込み済みコンテンツのオフライン閲覧、日本語・英語に対応しています。

## 動作環境

- iOS / iPadOS 18.4以降のSafari、またはAndroidの最新Chromeで動作します。
- ホーム画面への追加を推奨します。バッジやフルスクリーン表示など、一部の機能はホーム画面に追加したときだけ動作します。

## 使い方

[gh-mobile-plus.pages.dev](https://gh-mobile-plus.pages.dev) で先行公開しています。デスクトップのChromeでGitHubへのサインイン、通知一覧、公開リポジトリのActionsジョブログを確認済みです。iPhoneとAndroidでホーム画面に追加した状態の実機確認は未実施です。

- **iPhone・iPad**:Safariでアドレスを開き、共有ボタンから **ホーム画面に追加** を選びます。ホーム画面のGH Mobile+を開いて、そこでサインインしてください。インストールしたアプリのサインインはSafariとは別に保持されます。
- **Android**:Chromeでアドレスを開き、アプリに表示される **アプリをインストール** をタップするか、Chromeのメニューから **ホーム画面に追加** を選びます。
- **ブラウザ**:通常のタブでも利用できます。オンボーディングで **ブラウザで続ける** を選んでください。

## セルフホスト

Cloudflare Pagesの無料枠で動作します。

1. GitHubで**OAuth App**を作成します。コールバックURLは`https://<プロジェクト名>.pages.dev/auth/callback`にし、期限付きユーザートークン(expiring user tokens)を有効にします。
2. Cloudflare PagesでDirect Uploadプロジェクトを作成し、本番ブランチを `main` にします。`wrangler.toml` の `name` にプロジェクト名を設定します。
3. [docs/SPEC.md §14](docs/SPEC.md#14-configuration)に記載の環境変数とシークレットを設定します。

`public/_headers` がContent Security Policyとセキュリティヘッダーを設定し、`public/_routes.json` がFunctionsを `/auth/*` に限定します。変数として `GHM_GITHUB_CLIENT_ID`、`GHM_TOKEN_MODE`(`expiring`)、`GHM_COOKIE_ACTIVE_KID` を設定します。シークレットとして `GHM_GITHUB_CLIENT_SECRET` と `GHM_COOKIE_KEYS` を設定します。Cookie鍵は `openssl rand -base64 32` で生成し、`{"k1":"<鍵>"}` の形式で保存します。`GHM_DEV_INSECURE_COOKIES`、`GHM_GITHUB_OAUTH_ORIGIN`、`GHM_GITHUB_API_ORIGIN` はローカル開発とテスト専用なので、本番では設定しないでください。About画面から公開リポジトリにリンクしたい場合は、任意のリポジトリ変数 `VITE_GHM_SOURCE_URL` に公開リポジトリのURLを設定します。

`main` にプッシュしてCIの全ジョブが成功すると、GitHub Actionsが検査済みのビルドをデプロイします。リポジトリ変数に `CLOUDFLARE_ACCOUNT_ID`、Actionsシークレットに Cloudflare Pages Edit 権限の `CLOUDFLARE_API_TOKEN` を設定します。OAuthのシークレットはCloudflare Pagesで管理します。

手動デプロイの場合は以下を実行します。

```sh
pnpm build
pnpm exec wrangler pages deploy dist --branch main
```

Cookie鍵を入れ替えるときは、新しいkidを `GHM_COOKIE_KEYS` に追加し、`GHM_COOKIE_ACTIVE_KID` をそのkidに向けます。古いkidは、残したいセッションの最長期間(リフレッシュトークンは最長6か月)が過ぎてから削除します。

## 開発

Node.js LTSとpnpmが必要です。

```sh
pnpm install
cp .dev.vars.example .dev.vars   # 開発用OAuth Appの値を記入
pnpm dev
```

ローカル開発用には本番とは別のOAuth Appを用意してください。コールバックURLは`http://localhost:8788/auth/callback`です。

| 用途 | コマンド |
|---|---|
| インストール | `pnpm install --frozen-lockfile` |
| アプリと `/auth` 関数を http://localhost:8788 で起動 | `pnpm dev` |
| 型チェック | `pnpm typecheck` |
| Lint(警告ゼロ) | `pnpm lint` |
| フォーマットの確認 / 適用 | `pnpm format:check` / `pnpm format` |
| ユニットテストとWorkerテスト | `pnpm test` |
| E2Eテスト(WebKit iPhone 15、Chromium Pixel 8) | `pnpm e2e` |
| メッセージカタログの整合性 | `pnpm i18n:check` |
| 本番ビルドとサイズ上限の確認 | `pnpm build && pnpm size` |
| CIと同じチェック一式 | `pnpm ci:all` |
| GraphQLの型を再生成 | `pnpm gql:generate` |
| アプリアイコン / ライセンス一覧を再生成 | `pnpm icons` / `pnpm run licenses` |

初回のE2E実行前に `pnpm exec playwright install webkit chromium` が必要です。E2Eテストは本番ビルドをHTTPSのポート8788で配信し、ポート8790のモックGitHubを使います。`.dev.vars` は読み込みません。

開発ビルドでは、`/__diagnostics` がサインイン中のアカウントでSPEC §12のスパイク検証を実行します。通知の検証は、すでに既読のスレッドを1件選んで既読・完了にし、購読を解除します。

## アーキテクチャ

ReactのシングルページアプリがGitHubのREST APIとGraphQL APIをブラウザから直接呼び出します。`/auth`配下に置いた状態を持たないCloudflareの関数が、OAuthのコード交換とトークン更新だけを担当します。GitHubのトークンエンドポイントがブラウザからのリクエストを受け付けないため、この関数が必要です。

アクセストークンはメモリ上にだけ置き、リフレッシュトークンは暗号化したHttpOnly Cookieに保存します。データベース、アクセス解析、トラッキングはありません。

詳しくは[docs/SPEC.md](docs/SPEC.md)と[docs/adr](docs/adr)を参照してください。

## コントリビュート

[CONTRIBUTING.md](CONTRIBUTING.md)を参照してください。セキュリティ上の問題は[SECURITY.md](SECURITY.md)の手順で報告してください。

## ライセンス

[MIT](LICENSE)
