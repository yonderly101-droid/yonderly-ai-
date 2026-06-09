import { registerRootComponent } from 'expo';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);

// NOTE: This file is a placeholder for Expo-native apps. It will be served
// statically by Vercel but won't run in a plain browser environment. Keep it
// here to satisfy mobile bootstrap requirements if you add an Expo app later.
