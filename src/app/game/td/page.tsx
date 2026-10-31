import type { Metadata } from 'next';
import { copy } from '@/copy';
import { TdPage } from '@/components/td/TdPage';
export const metadata: Metadata = { title: `${copy.customer.td.pageTitle} · ${copy.shopName}` };
export default function Td() { return <TdPage />; }
