import RouteEditor from './route-editor';

export default async function TripRoutePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <RouteEditor key={id} tripId={id} />;
}
