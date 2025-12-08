import Link from 'next/link'
 
export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24 bg-black text-white">
      <h1 className="text-6xl font-bold mb-4 text-red-600">404</h1>
      <h2 className="text-2xl font-semibold mb-8">Page Not Found</h2>
      <p className="text-gray-400 mb-8 text-center max-w-md">
        The page you are looking for might have been removed, had its name changed, or is temporarily unavailable.
      </p>
      <Link 
        href="/"
        className="bg-red-600 hover:bg-red-700 text-white font-bold py-3 px-6 rounded transition-colors"
      >
        Return Home
      </Link>
    </main>
  )
}
