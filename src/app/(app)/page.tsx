import { redirect } from 'next/navigation';

// Root path → redirect to /overview
export default function Home() {
  redirect('/overview');
}
