// Help: what every screen is for and what the studio's words mean. The content
// is components/HelpContent.tsx, which reads the screens from the menu.
import HelpContent from "@/components/HelpContent";
import ConsoleShell from "@/components/shell/ConsoleShell";

export const metadata = { title: "Help" };

export default function HelpPage() {
  return (
    <ConsoleShell current="/help">
      <HelpContent />
    </ConsoleShell>
  );
}
