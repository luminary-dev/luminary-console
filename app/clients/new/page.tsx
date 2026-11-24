// Add a client: the form, in the console's frame.
import NewClientForm from "@/components/NewClientForm";
import ConsoleShell from "@/components/shell/ConsoleShell";

export const metadata = { title: "Add a client" };

export default function NewClientPage() {
  return (
    <ConsoleShell current="/clients/new" narrow>
      <NewClientForm />
    </ConsoleShell>
  );
}
