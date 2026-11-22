import { loadScript, getToken } from './google-auth.js';
import { FOLDER_MIME } from './drive-api.js';

// Google's own "choose a folder" window. Picking a folder gives the site permission to save into it.
export async function pickFolder(settings) {
  await loadScript('https://apis.google.com/js/api.js');
  await new Promise((resolve) => window.gapi.load('picker', resolve));
  const token = await getToken();
  const g = window.google.picker;

  return new Promise((resolve) => {
    const view = new g.DocsView(g.ViewId.FOLDERS)
      .setIncludeFolders(true)
      .setSelectFolderEnabled(true)
      .setMimeTypes(FOLDER_MIME);
    const picker = new g.PickerBuilder()
      .addView(view)
      .setTitle('בחר תיקייה לשמירה')
      .setLocale('iw')
      .setOAuthToken(token)
      .setDeveloperKey(settings.googleApiKey)
      .setAppId(settings.googleAppId)
      .setCallback((data) => {
        if (data.action === g.Action.PICKED) {
          const doc = data.docs[0];
          resolve({ id: doc.id, name: doc.name, url: doc.url });
        } else if (data.action === g.Action.CANCEL) {
          resolve(null);
        }
      })
      .build();
    picker.setVisible(true);
  });
}
