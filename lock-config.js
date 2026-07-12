/* ============================================================
   Site-wide passcode lock (optional)
   ------------------------------------------------------------
   Leave the hash EMPTY to disable the site-wide lock (you can
   still set a per-device passcode from Data & Settings).

   To require ONE passcode on EVERY device when the site opens:
     1. Open  set-passcode.html  (via your live site URL or a
        local server — not a plain file:// open).
     2. Type your passcode and click Generate.
     3. Copy the whole  window.PRESET_LOCK_HASH = "...";  line
        it prints and paste it below (replacing this one).
     4. git add lock-config.js && git commit -m "set passcode" && git push

   Only the one-way hash goes here — your actual passcode is
   never stored in the code. Pick something strong: the hash is
   public in your repo, so a weak/common passcode could be
   guessed offline.
   ============================================================ */
window.PRESET_LOCK_HASH = "";
