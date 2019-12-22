# browserpass-chromeos

**This is purely a development release for now, use at your own risk.**

## Usage

In order to use browserpass-chromeos instead of browserpass-native, use the fork [FabianHenneke/browserpass-extension](https://github.com/FabianHenneke/browserpass-extension) or apply [its last commit](https://github.com/FabianHenneke/browserpass-extension/commit/5efb1f9de6078b509904a83847d370c8e92fc097) to your browserpass-extension repository.

Then, do the following:

1. Install the [Google Smart Card Connector app](https://chrome.google.com/webstore/detail/smart-card-connector/khpfeaanjngmcnplbdlpegiifgpfgdco).
2. Launch the `Browserpass Chrome OS` app from the launcher and authorize access to a pass repository. This can be either a folder in your Downloads directory, a Google Drive folder (make it "available offline" for a better experience) or a shared Linux folder.
3. Open the options of the Browserpass extension and add the copied authorization code as the path of a custom store.
4. Connect a smart card reader or hardware token to your Chrome OS device. You can verify that it is recognized in the Smart Card Connector app.
5. When you first select a credential to fill, you will have to accept the Smart Card Connector's permission prompt.
