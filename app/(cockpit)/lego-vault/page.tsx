// F18: bench=lego_vault_load<800ms; surface=vault value vs invested + alert count
import { LegoVaultShell } from './_components/LegoVaultShell'

export const metadata = { title: 'Lego Vault — LepiOS' }

export default function LegoVaultPage() {
  return <LegoVaultShell />
}
