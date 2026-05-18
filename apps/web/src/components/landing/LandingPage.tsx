import { SvgDefs } from "@/components/landing/SvgDefs";
import { Topbar } from "@/components/landing/Topbar";
import { Hero } from "@/components/landing/Hero";
import { Partners } from "@/components/landing/Partners";
import { CampaignPreview } from "@/components/landing/CampaignPreview";
import { Pillars } from "@/components/landing/Pillars";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { Stats } from "@/components/landing/Stats";
import { UseCases } from "@/components/landing/UseCases";
import { Demo } from "@/components/landing/Demo";
import { CallToAction } from "@/components/landing/CallToAction";
import { FAQ } from "@/components/landing/FAQ";
import { Waitlist } from "@/components/landing/Waitlist";
import { Footer } from "@/components/landing/Footer";
import { ScrollReveal } from "@/components/landing/ScrollReveal";

export function LandingPage() {
  return (
    <>
      <SvgDefs />
      <Topbar />
      <Hero />
      <Partners />
      <CampaignPreview />
      <Pillars />
      <HowItWorks />
      <Stats />
      <UseCases />
      <Demo />
      <CallToAction />
      <FAQ />
      <Waitlist />
      <Footer />
      <ScrollReveal />
    </>
  );
}
