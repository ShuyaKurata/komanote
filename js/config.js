// アプリの設定
//
// Google ドライブ同期に使う OAuth クライアント ID。
// Google Cloud Console で作成した「ウェブアプリケーション」のクライアント ID を入れる(作り方は README を参照)。
// 空のままでも、アプリの「Googleドライブ → 設定」から端末ごとに入力できる。
export const GOOGLE_CLIENT_ID = '';

// Google ドライブ同期を使えるようにするか。
// しばらくは実装を止めておくので false(ボタンを押すと「準備中」と表示する)。
// 使えるようにするときは true にして、上の GOOGLE_CLIENT_ID を設定する。
export const DRIVE_ENABLED = false;
