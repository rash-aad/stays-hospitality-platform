import SitePage, { generateMetadata as gm } from './[slug]/page';

type Props = { params: Promise<{ host: string }> };
const withHome = (p: Props) => ({ params: p.params.then((x) => ({ ...x, slug: 'home' })) });

export const generateMetadata = (p: Props) => gm(withHome(p));
export default function Home(p: Props) {
  return <SitePage {...withHome(p)} />;
}
