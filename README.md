# browserpass-chromeos

**This is purely a development release for now, use at your own risk.**

## Usage

In order to use browserpass-chromeos instead of browserpass-native, make the following changes to `browserpass-extension/src/background.js`:

```diff
diff --git src/background.js src/background.js
index d36d7b8..154a322 100644
--- src/background.js
+++ src/background.js
@@ -6,8 +6,8 @@ const sha1 = require("sha1");
 const idb = require("idb");
 const helpers = require("./helpers");

-// native application id
-var appID = "com.github.browserpass.native";
+// browserpass-chromeos application id
+var appID = "fdlccgiobmfdfelpnaiaodldncpmcdlb";

 // OTP extension id
 var otpID = [
@@ -814,7 +814,7 @@ function hostAction(settings, action, params = {}) {
         request[key] = params[key];
     }

-    return chrome.runtime.sendNativeMessage(appID, request);
+    return chrome.runtime.sendMessage(appID, request);
 }

 /**
```
