import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
export const metadata: Metadata = { title: "YOSO OS | Agency Operations", description: "Internal agency operations workspace" };
export default function RootLayout({children}:{children:ReactNode}) { return <html lang="en"><body>{children}</body></html>; }
