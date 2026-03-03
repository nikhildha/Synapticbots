import Navbar from '@/components/landing/Navbar'
import Hero from '@/components/landing/Hero'
import StatsBanner from '@/components/landing/StatsBanner'
import HowItWorks from '@/components/landing/HowItWorks'
import Features from '@/components/landing/Features'
import LiveSignals from '@/components/landing/LiveSignals'
import Pricing from '@/components/landing/Pricing'
import FAQ from '@/components/landing/FAQ'
import CTABanner from '@/components/landing/CTABanner'
import Footer from '@/components/landing/Footer'

export default function LandingPage() {
  return (
    <>
      <Navbar />
      <main>
        <Hero />
        <StatsBanner />
        <HowItWorks />
        <Features />
        <LiveSignals />
        <Pricing />
        <FAQ />
        <CTABanner />
      </main>
      <Footer />
    </>
  )
}
