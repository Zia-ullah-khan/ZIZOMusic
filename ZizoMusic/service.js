import TrackPlayer, { Event } from 'react-native-track-player';

module.exports = async function() {
  TrackPlayer.addEventListener(Event.RemotePlay, () => TrackPlayer.play());
  TrackPlayer.addEventListener(Event.RemotePause, () => TrackPlayer.pause());
  TrackPlayer.addEventListener(Event.RemoteStop, () => TrackPlayer.stop());
  TrackPlayer.addEventListener(Event.RemoteNext, () => TrackPlayer.skipToNext());
  TrackPlayer.addEventListener(Event.RemotePrevious, async () => {
    try {
      const index = await TrackPlayer.getActiveTrackIndex();
      if (index != null && index > 0) {
        await TrackPlayer.skip(index - 1);
        return;
      }
    } catch (e) {
      // Fall through to native previous (seek to start on the first track).
    }
    TrackPlayer.skipToPrevious();
  });
  TrackPlayer.addEventListener(Event.RemoteSeek, (event) => TrackPlayer.seekTo(event.position));
  TrackPlayer.addEventListener(Event.RemoteJumpForward, () => TrackPlayer.seekBy(10));
  TrackPlayer.addEventListener(Event.RemoteJumpBackward, () => TrackPlayer.seekBy(-10));
};
