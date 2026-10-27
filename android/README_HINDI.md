# NBSC LAP Lead Agent Android APK

Yeh Android WebView wrapper hai jo hosted dashboard ko app window mein kholta hai. Yeh native/offline app nahi hai; internet aur live website/backend zaroori hain.

## APK banana
GitHub repository mein Actions tab kholen. "Build Android APK" workflow run hone dein. Successful run ke baad workflow run ke neeche Artifacts section se `nbsc-lap-debug-apk` download karein, ZIP extract karein, phir Android phone par `app-debug.apk` install karein.

Debug APK testing ke liye hai. Play Store release ke liye alag signed release build, app icon, privacy policy, aur final security review chahiye.
