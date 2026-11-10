export type UiLanguage = "en" | "zh-CN" | "ms";
// English is the explicit fallback for strings not translated to Malay yet.
const malay: Record<string, string> = {
  "Dismiss notification": "Tutup pemberitahuan",
  "Workspace": "Ruang kerja", "Your meetings": "Mesyuarat anda", "Needs review": "Perlu semakan",
  "New meeting": "Mesyuarat baharu", "Restore backup": "Pulihkan sandaran", "RECENT MEETINGS": "MESYUARAT TERKINI",
  "View all meetings": "Lihat semua mesyuarat", "View all": "Lihat semua",
  "WORKSPACE": "RUANG KERJA", "Settings & API keys": "Tetapan dan kunci API", "How it works": "Cara penggunaan",
  "Saved on this device · Local storage": "Disimpan pada peranti ini", "All meetings": "Semua mesyuarat",
  "Transcript": "Transkrip", "Speakers": "Penutur", "Meeting notes": "Nota mesyuarat", "Saved locally": "Disimpan secara setempat",
  "Appearance": "Penampilan", "Font family": "Jenis fon", "Font size": "Saiz fon", "Normal": "Biasa", "Large": "Besar", "Extra large": "Sangat besar",
  "Save settings": "Simpan tetapan", "Cancel": "Batal", "Close dialog": "Tutup dialog", "Recording details": "Butiran rakaman",
  "Reattach source": "Lampirkan semula sumber", "Attach audio": "Lampirkan audio", "Transcribe": "Transkripsi",
  "Playback mode": "Mod main balik", "Edit speakers": "Edit penutur", "Immersive playback": "Main balik imersif",
  "Speaker review": "Semakan penutur", "Speaker review queue": "Senarai semakan penutur", "Unconfirmed": "Belum disahkan",
  "Confirmed": "Disahkan", "All": "Semua", "Search speakers": "Cari penutur", "Search name or ID": "Cari nama atau ID",
  "Sort by": "Susun mengikut", "Fragment count": "Bilangan petikan", "Voice review": "Semakan suara", "Speaker identity": "Identiti penutur",
  "Display name": "Nama paparan", "Save name": "Simpan nama", "Confirm name": "Sahkan nama", "Compare with": "Bandingkan dengan",
  "Sample": "Sampel", "Related transcript": "Transkrip berkaitan", "Unknown speaker": "Penutur tidak diketahui",
  "Version": "Versi", "Check for updates": "Semak kemas kini", "Update now": "Kemas kini sekarang", "Confirm update": "Sahkan kemas kini",
  "Processing your request": "Sedang memproses permintaan", "Stop waiting": "Berhenti menunggu", "The conversation": "Perbualan",
};
export function translateUi(language: string, english: string, chinese: string): string {
  return language === "zh-CN" ? chinese : language === "ms" ? malay[english] ?? english : english;
}
