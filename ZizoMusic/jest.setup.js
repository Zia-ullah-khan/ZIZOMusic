import mockAsyncStorage from '@react-native-async-storage/async-storage/jest/async-storage-mock';

jest.mock('@react-native-async-storage/async-storage', () => mockAsyncStorage);

jest.mock('react-native-svg', () => {
  const React = require('react');
  const { View } = require('react-native');
  const Mock = (props) => React.createElement(View, props);
  return {
    __esModule: true,
    default: Mock,
    Svg: Mock,
    Circle: Mock,
    Line: Mock,
    Path: Mock,
    Polygon: Mock,
    Polyline: Mock,
    Rect: Mock,
  };
});

jest.mock('react-native-track-player', () => ({
  setupPlayer: jest.fn(),
  updateOptions: jest.fn(),
  add: jest.fn(),
  play: jest.fn(),
  pause: jest.fn(),
  skipToNext: jest.fn(),
  skipToPrevious: jest.fn(),
  skip: jest.fn(),
  seekTo: jest.fn(),
  reset: jest.fn(),
  remove: jest.fn(),
  setVolume: jest.fn(),
  setRepeatMode: jest.fn(),
  getQueue: jest.fn(async () => []),
  getActiveTrackIndex: jest.fn(async () => null),
  getActiveTrack: jest.fn(async () => null),
  getProgress: jest.fn(async () => ({ position: 0, duration: 0 })),
  getPlaybackState: jest.fn(async () => ({ state: 'stopped' })),
  updateMetadataForTrack: jest.fn(),
  usePlaybackState: () => ({ state: 'stopped' }),
  useProgress: () => ({ position: 0, duration: 0, buffered: 0 }),
  useTrackPlayerEvents: jest.fn(),
  TrackType: {
    HLS: 'hls',
    Default: 'default',
  },
  Capability: {
    Play: 'Play',
    Pause: 'Pause',
    SkipToNext: 'SkipToNext',
    SkipToPrevious: 'SkipToPrevious',
    SeekTo: 'SeekTo',
    JumpForward: 'JumpForward',
    JumpBackward: 'JumpBackward',
    PlayFromId: 'PlayFromId',
    PlayFromSearch: 'PlayFromSearch',
  },
  AppKilledPlaybackBehavior: {
    StopPlaybackAndRemoveNotification: 'StopPlaybackAndRemoveNotification',
    ContinuePlayback: 'ContinuePlayback',
  },
  Event: {
    PlaybackState: 'PlaybackState',
    PlaybackError: 'PlaybackError',
    PlaybackActiveTrackChanged: 'PlaybackActiveTrackChanged',
    PlaybackQueueEnded: 'PlaybackQueueEnded',
    PlaybackProgressUpdated: 'PlaybackProgressUpdated',
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
