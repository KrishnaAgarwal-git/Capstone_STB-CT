import logo from "../assets/logo.png";
import FeaturesSection from "./FeaturesSection";
import Header from "./Header";
import StatsSection from "./StatsSection";
import Trinity from "./Trinity";
import Footer from "./Footer";

function Home(){
    return (
        <>
        <Header/>
        <Trinity/>
        <StatsSection/>
        <FeaturesSection/>
        <Footer/>
        </>
    )
}

export default Home;