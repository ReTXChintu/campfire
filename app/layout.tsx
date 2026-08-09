import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Bebas_Neue } from "next/font/google";
import { auth } from "@/auth";
import { isAdminEmail } from "@/lib/admin";
import TopBar from "@/components/TopBar";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

const bebasNeue = Bebas_Neue({
  variable: "--font-bebas-neue",
  subsets: ["latin"],
  weight: "400",
});

export const metadata: Metadata = {
  title: "Campfire",
  description: "Personal streaming and watch party app",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const session = await auth();

  return (
    <html
      lang="en"
      className={`${inter.variable} ${jetbrainsMono.variable} ${bebasNeue.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col font-sans">
        <TopBar session={session} isAdmin={isAdminEmail(session?.user?.email)} />
        {children}
      </body>
    </html>
  );
}
