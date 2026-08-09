import AdminNav from "../../components/admin/AdminNav";
import ConverterPage from "../../components/admin/ConverterPage";

export default function AdminConverterPage() {
  return (
    <div className="w-full flex-1 px-4 py-8 sm:px-6">
      <AdminNav active="converter" />
      <h1 className="mb-2 font-display text-4xl tracking-wide text-white">Converter</h1>
      <p className="mb-8 text-sm text-text-secondary">
        Convert a video from your device into a browser-native MP4, then download it and add it to
        your Drive folder yourself.
      </p>
      <ConverterPage />
    </div>
  );
}
