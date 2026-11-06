# 展示キオスクのサーバー設定

キオスクのゲーム生成、モデル一覧、API キー管理には Supabase Edge Function とマイグレーションが必要です。デプロイ前に対象 Supabase プロジェクトを確認し、マイグレーションを適用してから `kosen-ai-proxy` をデプロイしてください。Web 側の変更も別途デプロイが必要です。

```sh
supabase db push
supabase functions deploy kosen-ai-proxy
```

スタッフの初回登録には `STAFF_ENROLLMENT_SECRET` を Supabase の Edge Function secrets に設定してください。旧来の既定値や展示設定のパスコードは使われません。既存のスタッフが Supabase Auth でログインできる場合は、管理画面から登録シークレットを新しい非公開テーブルに保存することもできます。環境変数が設定されている間は環境変数が優先されます。旧設定テーブル内のシークレットはこの機能には移行されないため、新しい値を設定してください。

管理画面で登録した Gemini、OpenRouter、Surplus のキーは `kosen_provider_secrets` に保存され、ブラウザには送信されません。対応する Edge Function の環境変数（`GEMINI_API_KEY`、`OPENROUTER_API_KEY`、`SURPLUS_API_KEY`）がある場合は環境変数が優先されます。スタッフ登録、キー管理、サーバー経由の生成には有効な Supabase Auth スタッフセッションが必要です。
