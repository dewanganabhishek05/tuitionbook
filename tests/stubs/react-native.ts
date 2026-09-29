// Minimal stand-ins so the app's data layer runs under Node for tests.
export const Platform = { OS: 'android' };
export const opened: string[] = [];
export const Linking = { openURL: async (u: string) => { opened.push(u); return true; } };
