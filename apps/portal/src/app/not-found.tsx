import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="font-heading text-5xl font-black text-primary">404</p>
      <h1 className="font-heading text-xl font-bold">This page does not exist</h1>
      <Link href="/" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
        Back to overview
      </Link>
    </main>
  );
}
