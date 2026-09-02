import type { Metadata } from "next";
import { AgentHarness } from "./agent-harness";

export const metadata: Metadata = {
  title: "Design Harness",
  description: "A code-native canvas for designing React applications.",
};

export default function Home() {
  return <AgentHarness />;
}
