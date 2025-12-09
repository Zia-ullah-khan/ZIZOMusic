import mockAsyncStorage from '@react-native-async-storage/async-storage/jest/async-storage-mock';

jest.mock('@react-native-async-storage/async-storage', () => mockAsyncStorage);

jest.mock('react-native-track-player', () => ({
  setupPlayer: jest.fn(),
  updateOptions: jest.fn(),
  add: jest.fn(),
  play: jest.fn(),
  pause: jest.fn(),
  skipToNext: jest.fn(),
  skipToPrevious: jest.fn(),
  seekTo: jest.fn(),
  reset: jest.fn(),
  usePlaybackState: () => 'stopped',
  useTrackPlayerEvents: jest.fn(),
  Capability: {
    Play: 'Play',
    Pause: 'Pause',
    SkipToNext: 'SkipToNext',
    SkipToPrevious: 'SkipToPrevious',
    SeekTo: 'SeekTo',
    PlayFromId: 'PlayFromId',
    PlayFromSearch: 'PlayFromSearch',
  },
  AppKilledPlaybackBehavior: {
    StopPlaybackAndRemoveNotification: 'StopPlaybackAndRemoveNotification',
  },
  Event: {
    PlaybackState: 'PlaybackState',
    PlaybackError: 'PlaybackError',
  },
  RepeatMode: {
    Off: 0,
    Track: 1,
    Queue: 2,
  },
  State: {
    None: 'none',
    Ready: 'ready',
    Playing: 'playing',
    Paused: 'paused',
    Stopped: 'stopped',
    Buffering: 'buffering',
    Connecting: 'connecting',
  },
}));

jest.mock('react-native-carplay', () => ({
  CarPlay: {
    setRootTemplate: jest.fn(),
  },
  ListTemplate: jest.fn(),
}));
