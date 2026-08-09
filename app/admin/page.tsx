import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { isAdminEmail } from "@/lib/admin";
import ConverterPage from "@/components/admin/ConverterPage";
import AdminNav from "@/components/admin/AdminNav";

export default async function AdminPage() {
  const session = await auth();
  if (!isAdminEmail(session?.user?.email)) {
    redirect("/");
  }

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
