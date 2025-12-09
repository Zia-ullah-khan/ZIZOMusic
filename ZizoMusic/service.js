module.exports = async function() {
  let TrackPlayer = require('react-native-track-player');
  
  // Handle ES Module interop if necessary
  if (TrackPlayer.default) {
    TrackPlayer = TrackPlayer.default;
  }

  try {
    TrackPlayer.addEventListener('remote-play', () => TrackPlayer.play());
    TrackPlayer.addEventListener('remote-pause', () => TrackPlayer.pause());
    TrackPlayer.addEventListener('remote-stop', () => TrackPlayer.reset());
    TrackPlayer.addEventListener('remote-next', () => TrackPlayer.skipToNext());
    TrackPlayer.addEventListener('remote-previous', () => TrackPlayer.skipToPrevious());
    TrackPlayer.addEventListener('remote-seek', (event) => TrackPlayer.seekTo(event.position));
    TrackPlayer.addEventListener('remote-play-id', (event) => console.log('Play from id:', event.id));
    TrackPlayer.addEventListener('remote-play-search', (event) => console.log('Play from search:', event.query));
  } catch (error) {
    console.error('Error registering playback service listeners:', error);
  }
};
