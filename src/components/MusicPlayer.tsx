import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MusicPlaylist, MusicSnapshot, MusicTrack } from "../types";
import { api, previewMode } from "../lib/api";
import { errorText } from "../lib/logic";
import { Icon } from "./Icon";

type RepeatMode = "off" | "all" | "one";

export function MusicPlayer({ visible, notify }: { visible: boolean; notify: (message: string, error?: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<MusicSnapshot>({ tracks: [], playlists: [] });
  const [selectedPlaylist, setSelectedPlaylist] = useState<string>("all");
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [repeat, setRepeat] = useState<RepeatMode>(() => (localStorage.getItem("ippo:music-repeat") as RepeatMode) || "off");
  const [volume, setVolume] = useState(() => Number(localStorage.getItem("ippo:music-volume") ?? "0.75"));
  const [queue, setQueue] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const audio = useRef<HTMLAudioElement>(null);
  const url = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    try { setSnapshot(await api.musicSnapshot()); }
    catch (e) { notify(errorText(e), true); }
  }, [notify]);

  useEffect(() => { if (!previewMode) void refresh(); }, [refresh]);
  useEffect(() => { localStorage.setItem("ippo:music-repeat", repeat); }, [repeat]);
  useEffect(() => {
    const safe = Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : .75;
    localStorage.setItem("ippo:music-volume", String(safe));
    if (audio.current) audio.current.volume = safe;
  }, [volume]);
  useEffect(() => () => { if (url.current) URL.revokeObjectURL(url.current); }, []);

  const playlist = snapshot.playlists.find((p) => p.id === selectedPlaylist);
  const tracksById = useMemo(() => new Map(snapshot.tracks.map((t) => [t.id, t])), [snapshot.tracks]);
  const visibleTracks = useMemo(() => {
    if (!playlist) return snapshot.tracks;
    return playlist.trackIds.map((id) => tracksById.get(id)).filter((track): track is MusicTrack => !!track);
  }, [playlist, snapshot.tracks, tracksById]);
  const current = currentId ? tracksById.get(currentId) : undefined;

  const loadAndPlay = useCallback(async (id: string, fromQueue?: string[]) => {
    const nextQueue = fromQueue?.length ? fromQueue : visibleTracks.map((t) => t.id);
    setQueue(nextQueue);
    setCurrentId(id); setLoading(true);
    try {
      const blob = await api.readMusicTrack(id);
      if (url.current) URL.revokeObjectURL(url.current);
      url.current = URL.createObjectURL(blob);
      const node = audio.current;
      if (!node) return;
      node.src = url.current; node.volume = volume;
      await node.play(); setPlaying(true);
    } catch (e) { setPlaying(false); notify(`Could not play this MP3: ${errorText(e)}`, true); }
    finally { setLoading(false); }
  }, [notify, visibleTracks, volume]);

  const step = useCallback((delta: 1 | -1, allowWrap = true) => {
    const activeQueue = queue.length ? queue : visibleTracks.map((t) => t.id);
    if (!activeQueue.length) return;
    const index = currentId ? activeQueue.indexOf(currentId) : -1;
    let next = index < 0 ? (delta > 0 ? 0 : activeQueue.length - 1) : index + delta;
    if (next < 0 || next >= activeQueue.length) {
      if (!allowWrap) { setPlaying(false); return; }
      next = (next + activeQueue.length) % activeQueue.length;
    }
    void loadAndPlay(activeQueue[next], activeQueue);
  }, [currentId, loadAndPlay, queue, visibleTracks]);

  async function importTracks() {
    try {
      const imported = await api.importMusic();
      if (!imported.length) return;
      await refresh();
      notify(`${imported.length} MP3 ${imported.length === 1 ? "track was" : "tracks were"} copied into Ippo. You can delete the originals.`);
    } catch (e) { notify(errorText(e), true); }
  }

  async function createPlaylist() {
    const name = window.prompt("Playlist name");
    if (!name?.trim()) return;
    try {
      const made = await api.createPlaylist(name.trim()); await refresh(); setSelectedPlaylist(made.id);
    } catch (e) { notify(errorText(e), true); }
  }

  async function updatePlaylist(nextIds: string[]) {
    if (!playlist) return;
    try { await api.setPlaylistTracks(playlist.id, nextIds); await refresh(); }
    catch (e) { notify(errorText(e), true); }
  }

  async function addToPlaylist(track: MusicTrack, targetId: string) {
    const target = snapshot.playlists.find((p) => p.id === targetId); if (!target || target.trackIds.includes(track.id)) return;
    try { await api.setPlaylistTracks(target.id, [...target.trackIds, track.id]); await refresh(); notify(`Added “${track.title}” to ${target.name}.`); }
    catch (e) { notify(errorText(e), true); }
  }

  async function deleteTrack(track: MusicTrack) {
    if (!window.confirm(`Remove “${track.title}” from Ippo's music library?`)) return;
    try {
      if (currentId === track.id) { audio.current?.pause(); setCurrentId(null); setPlaying(false); }
      await api.deleteMusicTrack(track.id); await refresh();
    } catch (e) { notify(errorText(e), true); }
  }

  async function deletePlaylist(item: MusicPlaylist) {
    if (!window.confirm(`Delete playlist “${item.name}”? The MP3 files will stay in your music library.`)) return;
    try { await api.deletePlaylist(item.id); setSelectedPlaylist("all"); await refresh(); }
    catch (e) { notify(errorText(e), true); }
  }

  function togglePlay() {
    const node = audio.current; if (!node) return;
    if (!currentId && visibleTracks[0]) { void loadAndPlay(visibleTracks[0].id); return; }
    if (node.paused) void node.play().then(() => setPlaying(true)).catch((e) => notify(errorText(e), true));
    else { node.pause(); setPlaying(false); }
  }

  function ended() {
    const node = audio.current;
    if (repeat === "one" && node) { node.currentTime = 0; void node.play(); return; }
    step(1, repeat === "all");
  }

  if (!visible) return <audio ref={audio} onEnded={ended} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} />;
  return <>
    <audio ref={audio} onEnded={ended} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} />
    <button className={`music-launcher${playing ? " playing" : ""}`} title="Reading music" aria-label="Open reading music" aria-expanded={open} onClick={() => setOpen((v) => !v)}><Icon name="music" size={18} /></button>
    {open && <aside className="music-panel" aria-label="Reading music player">
      <div className="music-head"><div><strong>Reading music</strong><span>{current ? current.title : "No track playing"}</span></div><button className="icon-button" aria-label="Close music" onClick={() => setOpen(false)}><Icon name="close" size={16} /></button></div>
      <div className="music-controls">
        <button className="icon-button" aria-label="Previous track" disabled={!snapshot.tracks.length} onClick={() => step(-1)}><Icon name="left" size={17} /></button>
        <button className="music-play" aria-label={playing ? "Pause" : "Play"} disabled={!snapshot.tracks.length || loading} onClick={togglePlay}><Icon name={playing ? "pause" : "play"} size={18} /></button>
        <button className="icon-button" aria-label="Next track" disabled={!snapshot.tracks.length} onClick={() => step(1)}><Icon name="right" size={17} /></button>
        <button className={`icon-button repeat-button ${repeat !== "off" ? "selected" : ""}`} title={`Repeat: ${repeat}`} aria-label={`Repeat ${repeat}`} onClick={() => setRepeat((r) => r === "off" ? "all" : r === "all" ? "one" : "off")}><Icon name={repeat === "one" ? "repeatone" : "repeat"} size={17} /></button>
      </div>
      <label className="music-volume"><span>Volume</span><input type="range" min="0" max="1" step="0.05" value={volume} onChange={(e) => setVolume(Number(e.target.value))} /></label>
      <div className="music-toolbar"><select aria-label="Playlist" value={selectedPlaylist} onChange={(e) => setSelectedPlaylist(e.target.value)}><option value="all">All songs</option>{snapshot.playlists.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select><button className="secondary compact" onClick={() => void createPlaylist()}>+ Playlist</button></div>
      {playlist && <div className="music-playlist-actions"><span>{playlist.trackIds.length} tracks · plays in this order</span><button className="text-button danger-text" onClick={() => void deletePlaylist(playlist)}>Delete playlist</button></div>}
      <div className="music-list">
        {visibleTracks.length ? visibleTracks.map((track, index) => <div className={`music-track${currentId === track.id ? " active" : ""}`} key={track.id}>
          <button className="track-main" onClick={() => void loadAndPlay(track.id, visibleTracks.map((t) => t.id))}><span className="track-number">{currentId === track.id && playing ? "♪" : index + 1}</span><span title={track.title}>{track.title}</span></button>
          {playlist ? <div className="track-actions"><button className="icon-button" disabled={index === 0} title="Move up" onClick={() => { const ids=[...playlist.trackIds]; [ids[index-1],ids[index]]=[ids[index],ids[index-1]]; void updatePlaylist(ids); }}><Icon name="up" size={14} /></button><button className="icon-button" disabled={index === playlist.trackIds.length - 1} title="Move down" onClick={() => { const ids=[...playlist.trackIds]; [ids[index+1],ids[index]]=[ids[index],ids[index+1]]; void updatePlaylist(ids); }}><Icon name="down" size={14} /></button><button className="icon-button" title="Remove from playlist" onClick={() => void updatePlaylist(playlist.trackIds.filter((id) => id !== track.id))}><Icon name="close" size={14} /></button></div> : <div className="track-actions">{snapshot.playlists.length > 0 && <select aria-label={`Add ${track.title} to playlist`} defaultValue="" onChange={(e) => { if (e.target.value) void addToPlaylist(track, e.target.value); e.currentTarget.value = ""; }}><option value="">Add to…</option>{snapshot.playlists.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>}<button className="icon-button" title="Remove MP3 from Ippo" onClick={() => void deleteTrack(track)}><Icon name="trash" size={14} /></button></div>}
        </div>) : <div className="music-empty"><Icon name="music" size={28} /><p>{playlist ? "This playlist is empty." : "Import MP3 files to listen while you read."}</p></div>}
      </div>
      <button className="primary music-import" onClick={() => void importTracks()}><Icon name="plus" size={16} />Import MP3 files</button>
      <p className="music-managed-note">Imported music is copied into Ippo. After import finishes, the original files can be deleted.</p>
    </aside>}
  </>;
}
