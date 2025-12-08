import Link from "next/link";

export default function Legal() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-start p-12 bg-black text-white">
      <div className="max-w-4xl w-full space-y-12">
        <div className="border-b border-gray-800 pb-8">
          <h1 className="text-5xl font-bold mb-4">Legal Information</h1>
          <p className="text-gray-400">Last Updated: December 7, 2025</p>
        </div>

        {/* Terms of Service */}
        <section>
          <h2 className="text-3xl font-bold mb-6 text-red-500">Terms of Service</h2>
          
          <div className="space-y-6 text-gray-300">
            <div>
              <h3 className="text-xl font-semibold text-white mb-2">1. Acceptance of Terms</h3>
              <p>By accessing and using ZIZO Music (&quot;the Service&quot;), you accept and agree to be bound by the terms and provision of this agreement. If you do not agree to abide by these terms, please do not use this Service.</p>
            </div>

            <div>
              <h3 className="text-xl font-semibold text-white mb-2">2. Description of Service</h3>
              <p>ZIZO Music is a multimedia search engine and playback tool. The Service acts as an indexer and proxy, allowing users to search for and stream content available publicly on third-party platforms (specifically YouTube). ZIZO Music does not host, upload, or store any audio or video files on its own servers.</p>
            </div>

            <div>
              <h3 className="text-xl font-semibold text-white mb-2">3. User Conduct</h3>
              <p>You agree to use the Service only for lawful purposes and in a way that does not infringe the rights of, restrict, or inhibit anyone else&apos;s use and enjoyment of the Service. You are strictly prohibited from using this Service to distribute, download, or reproduce copyrighted material without the permission of the copyright owner.</p>
            </div>

            <div>
              <h3 className="text-xl font-semibold text-white mb-2">4. Disclaimer of Warranties</h3>
              <p>The Service is provided on an &quot;AS IS&quot; and &quot;AS AVAILABLE&quot; basis. ZIZO Music makes no representations or warranties of any kind, express or implied, as to the operation of the Service or the information, content, or materials included therein. You expressly agree that your use of the Service is at your sole risk.</p>
            </div>

            <div>
              <h3 className="text-xl font-semibold text-white mb-2">5. Limitation of Liability</h3>
              <p>ZIZO Music shall not be liable for any damages of any kind arising from the use of this Service, including, but not limited to direct, indirect, incidental, punitive, and consequential damages.</p>
            </div>
          </div>
        </section>

        {/* Privacy Policy */}
        <section className="border-t border-gray-800 pt-12">
          <h2 className="text-3xl font-bold mb-6 text-red-500">Privacy Policy</h2>
          
          <div className="space-y-6 text-gray-300">
            <div>
              <h3 className="text-xl font-semibold text-white mb-2">1. Information Collection</h3>
              <p>We prioritize your privacy. We do not require account registration. The Service generates a random, anonymous User ID which is stored locally on your device (in LocalStorage). This ID is used solely to associate your listening history with your device for the purpose of generating recommendations.</p>
            </div>

            <div>
              <h3 className="text-xl font-semibold text-white mb-2">2. Use of Information</h3>
              <p>The anonymous data collected (listening history, search queries) is processed locally or on our backend solely to provide functionality (e.g., &quot;Recently Played&quot;, &quot;Recommended for You&quot;). We do not sell, trade, or rent your personal identification information to others.</p>
            </div>

            <div>
              <h3 className="text-xl font-semibold text-white mb-2">3. Third-Party Services</h3>
              <p>Our Service interacts with third-party APIs (YouTube). By using this Service, you acknowledge that your request data (search queries) is transmitted to these third-party services to retrieve content. We encourage you to review the privacy policies of these third-party platforms.</p>
            </div>
          </div>
        </section>

        {/* DMCA */}
        <section className="border-t border-gray-800 pt-12">
          <h2 className="text-3xl font-bold mb-6 text-red-500">DMCA & Copyright Disclaimer</h2>
          
          <div className="bg-zinc-900 p-8 rounded-xl border border-zinc-800">
            <p className="mb-4 text-gray-300">
              <strong>ZIZO Music respects the intellectual property rights of others.</strong>
            </p>
            <p className="mb-4 text-gray-300">
              We are a search engine and do not host any copyrighted content. All results presented are fetched from external third-party sources. We do not have control over the content hosted on these external sites.
            </p>
            <p className="mb-6 text-gray-300">
              If you believe that your copyrighted work has been copied in a way that constitutes copyright infringement and is accessible via this Service, please notify us. We will promptly blacklist specific keywords or URLs from our search results upon receipt of a valid DMCA notice.
            </p>

            <div className="bg-black p-6 rounded-lg border border-zinc-700">
              <h3 className="text-lg font-semibold mb-2 text-white">Submit a Takedown Request</h3>
              <p className="text-gray-400 mb-4">
                To request content removal or blacklisting, please email our designated agent with the subject line &quot;DMCA Takedown Request&quot;.
              </p>
              <div className="flex items-center gap-2 text-blue-400">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
                </svg>
                <a href="mailto:khansokan1234@gmail.com" className="hover:underline font-mono text-lg">
                  khansokan1234@gmail.com
                </a>
              </div>
            </div>
          </div>
        </section>
        
        <div className="pt-8 pb-16 text-center">
          <Link href="/" className="text-gray-500 hover:text-white transition-colors inline-flex items-center gap-2">
            <span>&larr;</span> Return to ZIZO Music
          </Link>
        </div>
      </div>
    </main>
  );
}
