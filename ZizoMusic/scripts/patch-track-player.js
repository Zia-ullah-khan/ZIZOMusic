const fs = require('fs');
const path = require('path');

const rntpRoot = path.join(
  __dirname,
  '..',
  'node_modules',
  'react-native-track-player',
  'android',
  'src',
  'main',
  'java',
  'com',
  'doublesymmetry',
  'trackplayer'
);

const musicModulePath = path.join(rntpRoot, 'module', 'MusicModule.kt');
const musicServicePath = path.join(rntpRoot, 'service', 'MusicService.kt');

const wrapExpressionLaunchBodies = (source) => {
  const pattern = /\s*=\s*scope\.launch \{/g;
  const matches = [];
  let match;
  while ((match = pattern.exec(source)) !== null) {
    matches.push({ index: match.index, length: match[0].length });
  }

  if (matches.length === 0) {
    return source;
  }

  let result = source;
  for (let i = matches.length - 1; i >= 0; i--) {
    const { index, length } = matches[i];
    const launchOpen = index + length - 1;
    let depth = 0;
    let end = -1;
    for (let pos = launchOpen; pos < result.length; pos++) {
      if (result[pos] === '{') depth++;
      if (result[pos] === '}') {
        depth--;
        if (depth === 0) {
          end = pos;
          break;
        }
      }
    }

    if (end === -1) {
      continue;
    }

    result = `${result.slice(0, end + 1)}\n    }${result.slice(end + 1)}`;
    result = `${result.slice(0, index)} {\n        scope.launch {${result.slice(index + length)}`;
  }

  return result;
};

const patchMusicModule = () => {
  if (!fs.existsSync(musicModulePath)) {
    return;
  }

  let source = fs.readFileSync(musicModulePath, 'utf8');
  const original = source;

  source = source.replace(
    'callback.resolve(Arguments.fromBundle(musicService.tracks[index].originalItem))',
    'callback.resolve(musicService.tracks[index].originalItem?.let { Arguments.fromBundle(it) })'
  );

  source = source.replace(
    `else Arguments.fromBundle(
                musicService.tracks[musicService.getCurrentTrackIndex()].originalItem
            )`,
    `else musicService.tracks[musicService.getCurrentTrackIndex()].originalItem?.let {
                Arguments.fromBundle(it)
            }`
  );

  source = wrapExpressionLaunchBodies(source);

  if (source !== original) {
    fs.writeFileSync(musicModulePath, source);
    console.log('Patched MusicModule.kt for New Architecture');
  }
};

const patchMusicService = () => {
  if (!fs.existsSync(musicServicePath)) {
    return;
  }

  let source = fs.readFileSync(musicServicePath, 'utf8');
  const original = source;

  source = source.replace(
    `    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startTask(getTaskConfig(intent))
        startAndStopEmptyNotificationToAvoidANR()
        return START_STICKY
    }`,
    `    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startTask(getTaskConfig(intent))
        try {
            startAndStopEmptyNotificationToAvoidANR()
        } catch (exception: Exception) {
            Timber.w(exception, "Unable to start temporary foreground notification")
        }
        return START_STICKY
    }`
  );

  const emitReplacement = `    @MainThread
    private fun emit(event: String, data: Bundle? = null) {
        reactContext
            ?.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            ?.emit(event, data?.let { Arguments.fromBundle(it) })
    }

    @MainThread
    private fun emitList(event: String, data: List<Bundle> = emptyList()) {
        val payload = Arguments.createArray()
        data.forEach { payload.pushMap(Arguments.fromBundle(it)) }

        reactContext
            ?.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            ?.emit(event, payload)
    }`;

  source = source.replace(
    `    @MainThread
    private fun emit(event: String, data: Bundle? = null) {
        reactNativeHost.reactInstanceManager.currentReactContext
            ?.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            ?.emit(event, data?.let { Arguments.fromBundle(it) })
    }

    @MainThread
    private fun emitList(event: String, data: List<Bundle> = emptyList()) {
        val payload = Arguments.createArray()
        data.forEach { payload.pushMap(Arguments.fromBundle(it)) }

        reactNativeHost.reactInstanceManager.currentReactContext
            ?.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            ?.emit(event, payload)
    }`,
    emitReplacement
  );

  if (source !== original) {
    fs.writeFileSync(musicServicePath, source);
    console.log('Patched MusicService.kt for New Architecture');
  }
};

patchMusicModule();
patchMusicService();
