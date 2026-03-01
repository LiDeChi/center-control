import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AppChrome } from "../components/app-chrome";
import "./globals.css";

export const metadata: Metadata = {
  title: "Center Control",
  description: "跨项目工作台"
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <AppChrome>{children}</AppChrome>
      </body>
    </html>
  );
}
