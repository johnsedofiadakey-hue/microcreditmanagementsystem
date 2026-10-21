import { ButtonLink, Container } from '@/components/ui';

export default function NotFound() {
  return (
    <Container className="flex flex-col items-start py-28">
      <p className="text-sm font-semibold uppercase tracking-[0.18em] text-primary">Page not found</p>
      <h1 className="mt-4 text-4xl font-black sm:text-5xl">We couldn&apos;t find that page.</h1>
      <p className="mt-4 max-w-lg text-lg text-muted-foreground">It may have moved. Start from the home page or ask us directly.</p>
      <div className="mt-8 flex flex-wrap gap-3">
        <ButtonLink href="/">Go home</ButtonLink>
        <ButtonLink href="/contact" variant="outline">Talk to us</ButtonLink>
      </div>
    </Container>
  );
}
