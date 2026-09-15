"use client";

export default function StudioError() {
  return <main style={{ padding: 32, maxWidth: 600, margin: "auto" }}>
    <h1>The studio couldn’t start</h1>
    <p>Your saved songs and drafts are still there. Reload the page to try again. If you opened the app from your home screen, try opening it in Safari.</p>
    <a href="/studio?retry=1">Reload studio</a>
  </main>;
}
