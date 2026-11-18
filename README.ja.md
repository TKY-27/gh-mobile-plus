# GH Mobile+

スマートフォンのための、非公式・無料・オープンソースのGitHubクライアントです。PWA(Progressive Web App)として動作します。

> GH Mobile+ はGitHub, Inc.とは無関係で、同社の承認を受けたものではありません。

## なぜ作ったのか

スマートフォンで差分をレビューしたり、通知から Issue を開いたり、自分のリポジトリを探したりできます。ブラウザからインストールでき、セッション情報とオフライン用データは端末に保存されます。

## 機能

- **ホーム**では、コントリビューション、最近プッシュしたリポジトリ、フォロー中のユーザーのアクティビティを確認できます。表示を切り替えると、スターを付けたリポジトリのリリースも確認できます。
- **リポジトリ**タブから自分のリポジトリを開けます。GitHub 全体を探すときは、検索タブで対象を選び、検索条件を指定できます。
- **タスク**では、レビュー依頼、作成した PR、担当している Issue と PR、失敗した CI を確認できます。
- **通知**はホーム右上のベルから開けます。一覧で個別に既読にしたり、複数選んでまとめて操作したりできます。
- **コードレビュー**:ファイルの確認済みマーク、ハンク単位の移動、行・範囲へのコメント、変更提案(suggestion)、レビューの送信
- **PR・Issue**:タイムライン、プレビューと補完付きの入力欄、ラベル、担当者、マージ。PRの状態は一覧・検索・詳細で共通のアイコンと色で表示
- **コード**:シンタックスハイライト付きで閲覧し、1ファイルを編集して、直接コミット、またはブランチ・Fork経由でPRを作成
- **Actions**:実行一覧、ジョブ、ログ、再実行、キャンセル、inputs付きのworkflow_dispatch
- 複数アカウント、任意で使えるアプリロック、読み込み済みコンテンツのオフライン閲覧、日本語・英語に対応

## 動作環境

- iOS / iPadOS 18.4以降のSafari、またはAndroidの最新Chrome
- ホーム画面への追加を推奨します。バッジやフルスクリーン表示など、一部の機能はホーム画面に追加したときだけ動作します。

## 使い方

[gh-mobile-plus.pages.dev](https://gh-mobile-plus.pages.dev) で先行公開しています。デスクトップのChromeでGitHubへのサインイン、通知一覧、公開リポジトリのActionsジョブログを確認済みです。iPhoneとAndroidでホーム画面に追加した状態の実機確認は未実施です。

- **iPhone・iPad**:Safariでアドレスを開き、共有ボタンから **ホーム画面に追加** を選びます。ホーム画面のGH Mobile+を開いて、そこでサインインしてください。インストールしたアプリのサインインはSafariとは別に保持されます。
- **Android**:Chromeでアドレスを開き、アプリに表示される **アプリをインストール** をタップするか、Chromeのメニューから **ホーム画面に追加** を選びます。
- **ブラウザ**:通常のタブでも使えます。オンボーディングで **ブラウザで続ける** を選んでください。

## セルフホスト

Cloudflare Pagesの無料枠で動作します。

1. GitHubで**OAuth App**を作成します。コールバックURLは`https://<プロジェクト名>.pages.dev/auth/callback`にし、期限付きユーザートークン(expiring user tokens)を有効にします。
2. Cloudflare PagesでDirect Uploadプロジェクトを作成し、本番ブランチを `main` にします。`wrangler.toml` の `name` にプロジェクト名を設定します。
3. [docs/SPEC.md §14](docs/SPEC.md#14-configuration)に記載の環境変数とシークレットを設定します。

`public/_headers` がContent Security Policyとセキュリティヘッダーを設定し、`public/_routes.json` がFunctionsを `/auth/*` に限定します。変数として `GHM_GITHUB_CLIENT_ID`、`GHM_TOKEN_MODE`(`expiring`)、`GHM_COOKIE_ACTIVE_KID` を、シークレットとして `GHM_GITHUB_CLIENT_SECRET` と `GHM_COOKIE_KEYS` を設定します。Cookie鍵は `openssl rand -base64 32` で生成し、`{"k1":"<鍵>"}` の形式で保存します。`GHM_DEV_INSECURE_COOKIES`、`GHM_GITHUB_OAUTH_ORIGIN`、`GHM_GITHUB_API_ORIGIN` はローカル開発とテスト専用なので、本番では設定しないでください。About画面から公開リポジトリにリンクしたい場合は、任意のリポジトリ変数 `VITE_GHM_SOURCE_URL` を設定します。

`main` にプッシュしてCIの全ジョブが通ると、GitHub Actionsが検査済みのビルドをデプロイします。リポジトリ変数に `CLOUDFLARE_ACCOUNT_ID`、Actionsシークレットに Cloudflare Pages Edit 権限の `CLOUDFLARE_API_TOKEN` を設定します。OAuthのシークレットはCloudflare Pagesで管理します。

手動デプロイの場合は以下を実行します。

```sh
pnpm build
pnpm exec wrangler pages deploy dist --branch main
```

Cookie鍵を入れ替えるときは、新しいkidを `GHM_COOKIE_KEYS` に追加して `GHM_COOKIE_ACTIVE_KID` をそれに向け、残したいセッションの最長期間(リフレッシュトークンは最長6か月)が過ぎてから古いkidを削除します。

## 開発

Node.js LTSとpnpmが必要です。

```sh
pnpm install
cp .dev.vars.example .dev.vars   # 開発用OAuth Appの値を記入
pnpm dev
```

ローカル開発用には、本番とは別のOAuth Appを用意してください。コールバックURLは`http://localhost:8788/auth/callback`です。

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

開発ビルドでは、`/__diagnostics` がサインイン中のアカウントでSPEC §12のスパイク検証を実行します。通知の検証は、既読のスレッドを1件選んで既読・完了にし、購読を解除します。

## アーキテクチャ

ReactのシングルページアプリがGitHubのREST APIとGraphQL APIをブラウザから直接呼び出します。`/auth`配下には、状態を持たない小さなCloudflareの関数を置いています。これはOAuthのコード交換とトークン更新だけを担当します。GitHubのトークンエンドポイントがブラウザからのリクエストを受け付けないため、この関数が必要です。

アクセストークンはメモリ上にだけ置き、リフレッシュトークンは暗号化したHttpOnly Cookieに保存します。データベース、アクセス解析、トラッキングは一切ありません。

詳しくは[docs/SPEC.md](docs/SPEC.md)と[docs/adr](docs/adr)を参照してください。

## コントリビュート

[CONTRIBUTING.md](CONTRIBUTING.md)を参照してください。セキュリティ上の問題は[SECURITY.md](SECURITY.md)の手順で報告してください。

## ライセンス

[MIT](LICENSE)
